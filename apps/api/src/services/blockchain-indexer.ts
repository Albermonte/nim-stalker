import { type Block, type Subscription, BlockType } from '@albermonte/nimiq-rpc-client-ts'
import { ensureRpcClient, getRpcClient, mapTransaction, unwrap } from './rpc-client'
import { rebuildAllEdgeAggregates, writeTransactionBatch, updateEdgeAggregatesForPairs, markBackfilledAddressesComplete, updateAddressBalances } from './indexing'
import { readTx, toNumber } from '../lib/neo4j'
import { config } from '../lib/config'
import { openIndexerDb, type IndexerDb } from '../lib/indexer-db'
import { withTimeout, poolAll } from '../lib/concurrency'
import { formatAddress } from '../lib/address-utils'

const MAX_CONSECUTIVE_ERRORS = 10

interface IndexerState {
  lastProcessedBatch: number
  liveSubscriptionActive: boolean
  running: boolean
  backfillComplete: boolean
  skippedBatches: number[]
  lastGapScanAt: number
  gapRepairsCompleted: number
}

const state: IndexerState = {
  lastProcessedBatch: -1,
  liveSubscriptionActive: false,
  running: false,
  backfillComplete: false,
  skippedBatches: [],
  lastGapScanAt: 0,
  gapRepairsCompleted: 0,
}

let subscription: Subscription<Block> | null = null
let indexerDb: IndexerDb | null = null
let blockProcessingChain = Promise.resolve()

interface BackfillTuning {
  checkpointInterval: number
  throttleMs: number
  throttleEveryBatches: number
  deferAggregates: boolean
}

// --- Helpers ---

function extractPairs(txs: Array<{ from: string; to: string }>): Array<{ from: string; to: string }> {
  return txs.map((tx) => ({ from: tx.from, to: tx.to }))
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback
  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

export function parseBackfillTuning(env: Record<string, string | undefined>): BackfillTuning {
  return {
    checkpointInterval: parsePositiveInt(env.BACKFILL_CHECKPOINT_INTERVAL, 100),
    throttleMs: parseNonNegativeInt(env.BACKFILL_THROTTLE_MS, 0),
    throttleEveryBatches: parsePositiveInt(env.BACKFILL_THROTTLE_EVERY_BATCHES, 10),
    deferAggregates: parseBoolean(env.BACKFILL_DEFER_AGGREGATES, true),
  }
}

interface GapRepairConfig {
  intervalMs: number
  maxPerCycle: number
}

export function parseGapRepairConfig(env: Record<string, string | undefined>): GapRepairConfig {
  return {
    intervalMs: parsePositiveInt(env.GAP_REPAIR_INTERVAL_MS, 300_000), // 5 min
    maxPerCycle: parsePositiveInt(env.GAP_REPAIR_MAX_PER_CYCLE, 50),
  }
}

export function shouldPersistBackfillCheckpoint(
  batch: number,
  startBatch: number,
  endBatch: number,
  checkpointInterval: number
): boolean {
  if (batch === endBatch) return true
  const processed = batch - startBatch + 1
  return processed % checkpointInterval === 0
}

export function estimateBackfillEtaMs(
  processedBatches: number,
  remainingBatches: number,
  elapsedMs: number
): number | null {
  if (processedBatches <= 0 || remainingBatches < 0 || elapsedMs <= 0) return null
  const avgMsPerBatch = elapsedMs / processedBatches
  const etaMs = Math.round(avgMsPerBatch * remainingBatches)
  return Number.isFinite(etaMs) ? etaMs : null
}

export function formatEta(etaMs: number | null): string {
  if (etaMs == null || !Number.isFinite(etaMs)) return 'unknown'

  const totalSeconds = Math.max(0, Math.floor(etaMs / 1000))
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function isNotFoundError(msg: string): boolean {
  const lower = msg.toLowerCase()
  return lower.includes('not found') || lower.includes('does not exist')
}

// --- Consensus readiness ---

export function isConsensusEstablishedResponse(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false

  const result = (payload as { result?: unknown }).result
  if (typeof result === 'boolean') {
    return result
  }

  if (result && typeof result === 'object') {
    const wrapped = result as { data?: unknown }
    return wrapped.data === true
  }

  return false
}

async function waitForConsensus(pollInterval = 10_000): Promise<void> {
  const rpcUrl = config.nimiqRpcUrl
  let lastLog = 0

  while (state.running) {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'isConsensusEstablished', params: [], id: 1 }),
      })
      if (res.ok) {
        const data = await res.json() as unknown
        if (isConsensusEstablishedResponse(data)) {
          console.log('[backfill] Consensus established')
          return
        }
        if (Date.now() - lastLog > 60_000) {
          console.log('[backfill] Node reachable, waiting for consensus...')
          lastLog = Date.now()
        }
      }
    } catch {
      if (Date.now() - lastLog > 60_000) {
        console.warn('[backfill] Node not reachable, waiting...')
        lastLog = Date.now()
      }
    }
    await new Promise(r => setTimeout(r, pollInterval))
  }
}

// --- RPC readiness ---

async function waitForRpc(maxRetries = 20, baseDelay = 3000): Promise<number> {
  const client = getRpcClient()
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await withTimeout(
        client.blockchain.getBatchNumber(),
        15_000,
        'getBatchNumber'
      )
      return unwrap<number>(result)
    } catch (error) {
      const delay = Math.min(baseDelay * 2 ** (attempt - 1), 60_000)
      console.warn(`[backfill] RPC not ready (attempt ${attempt}/${maxRetries}): ${error instanceof Error ? error.message : error}`)
      if (attempt === maxRetries) throw error
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('RPC readiness check exhausted') // unreachable
}

// --- Migration from Neo4j Meta node ---

async function migrateFromNeo4jMeta(db: IndexerDb): Promise<void> {
  if (db.getMeta('migrated_from_neo4j') === 'true') return
  if (db.getLastIndexedBatch() >= 0) {
    // SQLite already has data, skip migration
    db.setMeta('migrated_from_neo4j', 'true')
    return
  }

  const metaResult = await readTx(async (tx) => {
    const result = await tx.run(
      `MATCH (m:Meta {key: $key}) RETURN m.lastProcessedBatch AS batch`,
      { key: 'indexer' }
    )
    if (result.records.length === 0) return -1
    const val = result.records[0].get('batch')
    return typeof val === 'number' ? val : Number(val)
  })

  if (metaResult > 0) {
    console.log(`[migration] Migrating ${metaResult} batches from Neo4j Meta node to SQLite...`)
    // Bulk insert in chunks to avoid overwhelming SQLite
    const CHUNK_SIZE = 10_000
    for (let start = 1; start <= metaResult; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE - 1, metaResult)
      for (let batch = start; batch <= end; batch++) {
        db.markBatchIndexed(batch, 0) // tx_count unknown for historical batches
      }
    }
    console.log(`[migration] Migration complete — ${metaResult} batches marked in SQLite`)
  }

  db.setMeta('migrated_from_neo4j', 'true')
}

// --- Backfill worker ---

async function runBackfill(): Promise<void> {
  await waitForConsensus()

  const tuning = parseBackfillTuning(process.env)
  const db = indexerDb!
  const client = getRpcClient()

  // Migrate from Neo4j Meta node on first run
  await migrateFromNeo4jMeta(db)

  // Self-healing: mark backfilled addresses from prior runs
  await markBackfilledAddressesComplete()

  state.lastProcessedBatch = db.getLastIndexedBatch()
  let currentBatch = await waitForRpc()

  if (state.lastProcessedBatch >= currentBatch) {
    console.log(`[backfill] Already caught up (batch ${state.lastProcessedBatch}/${currentBatch})`)
    state.backfillComplete = true
    return
  }

  // Gap-aware: find ALL unindexed batches from 1 to currentBatch
  const gaps = db.getUnindexedBatches(1, currentBatch)

  if (gaps.length === 0) {
    console.log(`[backfill] No gaps found — fully indexed up to batch ${currentBatch}`)
    state.lastProcessedBatch = db.getLastIndexedBatch()
    state.backfillComplete = true
    return
  }

  console.log(`[backfill] ${gaps.length} unindexed batches to process (1..${currentBatch})`)
  console.log(
    `[backfill] Tuning throttle=${tuning.throttleMs}ms/${tuning.throttleEveryBatches} batches, deferAggregates=${tuning.deferAggregates}`
  )

  const backfillStartMs = Date.now()
  let aggregateRebuildNeeded = false
  let consecutiveErrors = 0
  let processedCount = 0

  for (let i = 0; i < gaps.length; i++) {
    const batch = gaps[i]

    if (!state.running) {
      state.lastProcessedBatch = db.getLastIndexedBatch()
      console.log('[backfill] Stopped')
      return
    }

    try {
      const result = await withTimeout(
        client.blockchain.getTransactionsByBatchNumber(batch),
        30_000,
        `getTransactionsByBatchNumber(${batch})`
      )
      const rawTxs = unwrap<any[]>(result)

      if (rawTxs && rawTxs.length > 0) {
        const txs = rawTxs.map(mapTransaction)
        const writeResult = await writeTransactionBatch(txs)

        if (writeResult.count > 0) {
          if (tuning.deferAggregates) {
            aggregateRebuildNeeded = true
          } else {
            const pairs = extractPairs(txs)
            await updateEdgeAggregatesForPairs(pairs)
          }
        }

        db.markBatchIndexed(batch, writeResult.count)
      } else {
        db.markBatchIndexed(batch, 0)
      }

      consecutiveErrors = 0
      processedCount++
      state.lastProcessedBatch = db.getLastIndexedBatch()

      if (processedCount % 100 === 0) {
        const remainingBatches = gaps.length - processedCount
        const etaMs = estimateBackfillEtaMs(processedCount, remainingBatches, Date.now() - backfillStartMs)
        const progress = ((processedCount / gaps.length) * 100).toFixed(1)
        console.log(`[backfill] ${processedCount}/${gaps.length} batches (${progress}%, ETA ${formatEta(etaMs)})`)
      }

      // Small delay to avoid overwhelming the RPC node
      if (tuning.throttleMs > 0 && processedCount % tuning.throttleEveryBatches === 0) {
        await new Promise((r) => setTimeout(r, tuning.throttleMs))
      }
    } catch (error) {
      consecutiveErrors++
      const msg = error instanceof Error ? error.message : String(error)

      // Handle "not found" as empty batch
      if (isNotFoundError(msg)) {
        console.warn(`[backfill] Batch ${batch} not found, treating as empty`)
        db.markBatchIndexed(batch, 0)
        consecutiveErrors = 0
        processedCount++
        continue
      }

      console.error(`[backfill] Error processing batch ${batch}:`, msg)

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`[backfill] ${MAX_CONSECUTIVE_ERRORS} consecutive errors — skipping batch ${batch}`)
        state.skippedBatches.push(batch)
        consecutiveErrors = 0
        // Don't mark in SQLite — it remains a gap for future retry
        continue
      }

      // Exponential backoff: 5s, 10s, 20s, 40s, capped at 60s
      const delay = Math.min(5000 * 2 ** (consecutiveErrors - 1), 60_000)
      console.log(`[backfill] Retrying in ${delay / 1000}s (attempt ${consecutiveErrors})`)
      await new Promise((r) => setTimeout(r, delay))
      // Retry same batch
      i--
    }
  }

  // Process trailing batches that arrived during backfill
  let caughtUp = false
  while (state.running && !caughtUp) {
    try {
      const latestResult = await withTimeout(
        client.blockchain.getBatchNumber(),
        15_000,
        'getBatchNumber'
      )
      const latestBatch = unwrap<number>(latestResult)
      const newGaps = db.getUnindexedBatches(currentBatch + 1, latestBatch)
      if (newGaps.length === 0) {
        caughtUp = true
        break
      }
      console.log(`[backfill] ${newGaps.length} new batches arrived during backfill, processing...`)
      for (const batch of newGaps) {
        if (!state.running) break
        try {
          const result = await withTimeout(
            client.blockchain.getTransactionsByBatchNumber(batch),
            30_000,
            `getTransactionsByBatchNumber(${batch})`
          )
          const rawTxs = unwrap<any[]>(result)
          if (rawTxs && rawTxs.length > 0) {
            const txs = rawTxs.map(mapTransaction)
            const writeResult = await writeTransactionBatch(txs)
            if (writeResult.count > 0) {
              if (tuning.deferAggregates) {
                aggregateRebuildNeeded = true
              } else {
                const pairs = extractPairs(txs)
                await updateEdgeAggregatesForPairs(pairs)
              }
            }
            db.markBatchIndexed(batch, writeResult.count)
          } else {
            db.markBatchIndexed(batch, 0)
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (isNotFoundError(msg)) {
            db.markBatchIndexed(batch, 0)
          } else {
            console.warn(`[backfill] Failed trailing batch ${batch}: ${msg}`)
            // Leave unindexed — gap repair will handle it
          }
        }
      }
      currentBatch = latestBatch
    } catch (err) {
      console.warn('[backfill] Failed to check for newer batches:', err instanceof Error ? err.message : err)
      caughtUp = true // Exit loop on RPC failure, gap repair will handle the rest
    }
  }

  if (tuning.deferAggregates && aggregateRebuildNeeded) {
    console.log('[backfill] Rebuilding TRANSACTED_WITH aggregates after backfill...')
    await rebuildAllEdgeAggregates()
    console.log('[backfill] Aggregate rebuild complete')
  }

  await markBackfilledAddressesComplete()
  state.lastProcessedBatch = db.getLastIndexedBatch()
  state.backfillComplete = true

  if (state.skippedBatches.length > 0) {
    console.warn(`[backfill] Complete with ${state.skippedBatches.length} skipped batches: ${state.skippedBatches.slice(0, 20).join(', ')}${state.skippedBatches.length > 20 ? '...' : ''}`)
  } else {
    console.log(`[backfill] Complete — processed up to batch ${state.lastProcessedBatch}`)
  }
}

// --- Live subscription ---

async function startLiveSubscription(): Promise<void> {
  await waitForConsensus()

  try {
    const client = getRpcClient()
    subscription = await client.blockchainStreams.subscribeForBlocks(undefined, {
      autoReconnect: {
        retries: () => state.running,
        delay: 5000,
        onFailed: () => {
          console.error('[live] WebSocket reconnection failed permanently')
          state.liveSubscriptionActive = false
        },
      },
      onError: (error) => {
        console.error('[live] WebSocket error:', error?.message)
      },
    })

    subscription.next((response) => {
      if (response.error) {
        console.error('[live] Stream error:', response.error.message)
        return
      }

      const block = response.data

      blockProcessingChain = blockProcessingChain.then(() =>
        processLiveBlock(block, client)
      ).catch((error) => {
        console.error(`[live] Error processing block #${block.number}:`, error instanceof Error ? error.message : error)
      })
    })

    state.liveSubscriptionActive = true
    console.log('[live] Subscribed to head blocks')
  } catch (error) {
    console.error('[live] Failed to start subscription:', error instanceof Error ? error.message : error)
    state.liveSubscriptionActive = false
  }
}

async function processLiveBlock(block: Block, client: ReturnType<typeof getRpcClient>): Promise<void> {
  // When a macro block closes a batch, verify all transactions are indexed
  if (block.type === BlockType.Macro && state.backfillComplete && indexerDb) {
    const completedBatch = block.batch - 1
    if (completedBatch > state.lastProcessedBatch) {
      // Fill transition gaps between last processed and completed batch
      const transitionGaps = indexerDb.getUnindexedBatches(state.lastProcessedBatch + 1, completedBatch)
      for (const gap of transitionGaps) {
        try {
          await verifyBatch(gap, client)
        } catch (err) {
          console.warn(`[live] Failed transition gap batch ${gap}: ${err instanceof Error ? err.message : err}`)
        }
      }
    }

    // Periodic gap repair (internally throttled)
    await repairGaps(client)
  }

  const transactions = block.transactions ?? []
  if (transactions.length === 0) return

  const txs = transactions.map(mapTransaction)
  const writeResult = await writeTransactionBatch(txs)

  if (writeResult.count > 0) {
    const pairs = extractPairs(txs)
    await updateEdgeAggregatesForPairs(pairs)

    // Balance updates — awaited to prevent concurrent pool pressure
    const uniqueAddresses = [...new Set(txs.flatMap(tx => [tx.from, tx.to]))]
    await fetchAndUpdateBalances(client, uniqueAddresses)
  }

  console.log(`[live] Block #${block.number}: ${writeResult.count} transactions indexed`)
}

async function fetchAndUpdateBalances(client: ReturnType<typeof getRpcClient>, addresses: string[]): Promise<void> {
  const tasks = addresses.map((addr) => async () => {
    try {
      const result = await withTimeout(
        client.blockchain.getAccountByAddress(addr, { withMetadata: false }),
        10_000,
        `getAccountByAddress(${addr})`
      )
      const account = unwrap<any>(result)
      return { address: formatAddress(addr), balance: String(account?.balance ?? 0) }
    } catch {
      return null
    }
  })

  const results = await poolAll(tasks, 5)
  const entries = results.filter((r): r is { address: string; balance: string } => r != null)
  if (entries.length > 0) {
    await updateAddressBalances(entries)
  }
}

async function verifyBatch(batch: number, client: ReturnType<typeof getRpcClient>): Promise<void> {
  try {
    const result = await withTimeout(
      client.blockchain.getTransactionsByBatchNumber(batch),
      30_000,
      `verifyBatch(${batch})`
    )
    const rawTxs = unwrap<any[]>(result)

    if (rawTxs && rawTxs.length > 0) {
      const txs = rawTxs.map(mapTransaction)
      const writeResult = await writeTransactionBatch(txs)

      if (writeResult.count > 0) {
        const pairs = extractPairs(txs)
        await updateEdgeAggregatesForPairs(pairs)
        console.log(`[live] Batch ${batch} verified: ${writeResult.count} new transactions indexed`)
      }

      indexerDb!.markBatchIndexed(batch, txs.filter(tx => tx.from && tx.to).length)
    } else {
      indexerDb!.markBatchIndexed(batch, 0)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (isNotFoundError(msg)) {
      indexerDb!.markBatchIndexed(batch, 0)
      return
    }
    throw error
  }

  state.lastProcessedBatch = indexerDb!.getLastIndexedBatch()
}

async function repairGaps(client: ReturnType<typeof getRpcClient>): Promise<void> {
  const db = indexerDb
  if (!db || !state.running || !state.backfillComplete) return

  const gapConfig = parseGapRepairConfig(process.env)

  // Throttle: skip if last scan was too recent
  if (Date.now() - state.lastGapScanAt < gapConfig.intervalMs) return

  state.lastGapScanAt = Date.now()

  let currentBatch: number
  try {
    const result = await withTimeout(
      client.blockchain.getBatchNumber(),
      15_000,
      'getBatchNumber'
    )
    currentBatch = unwrap<number>(result)
  } catch {
    return // RPC unavailable, skip this cycle
  }

  const gaps = db.getUnindexedBatches(1, currentBatch)
  if (gaps.length === 0) return

  const toProcess = gaps.slice(0, gapConfig.maxPerCycle)
  console.log(`[gap-repair] Found ${gaps.length} gaps, processing ${toProcess.length}...`)

  let repaired = 0
  for (const batch of toProcess) {
    if (!state.running) break
    try {
      await verifyBatch(batch, client)
      repaired++
    } catch (err) {
      console.warn(`[gap-repair] Failed batch ${batch}: ${err instanceof Error ? err.message : err}`)
    }
  }

  state.gapRepairsCompleted += repaired
  if (repaired > 0) {
    console.log(`[gap-repair] Repaired ${repaired}/${toProcess.length} gaps (${gaps.length - repaired} remaining)`)
  }
}

// --- Public API ---

export async function getIndexerStatus() {
  const db = indexerDb

  let totalTransactionsIndexed = 0
  try {
    totalTransactionsIndexed = await readTx(async (tx) => {
      const res = await tx.run('MATCH ()-[t:TRANSACTION]->() RETURN count(t) AS cnt')
      return toNumber(res.records[0]?.get('cnt'))
    })
  } catch {
    totalTransactionsIndexed = db ? db.getTotalTransactionsIndexed() : 0
  }

  return {
    lastProcessedBatch: state.lastProcessedBatch,
    liveSubscriptionActive: state.liveSubscriptionActive,
    totalTransactionsIndexed,
    indexedBatchCount: db ? db.getIndexedBatchCount() : 0,
    running: state.running,
    backfillComplete: state.backfillComplete,
    skippedBatches: state.skippedBatches.length,
    gapRepairsCompleted: state.gapRepairsCompleted,
    lastGapScanAt: state.lastGapScanAt || null,
  }
}

export async function getIndexerStatusWithProgress() {
  let currentBatch = 0
  try {
    const client = getRpcClient()
    const result = await withTimeout(
      client.blockchain.getBatchNumber(),
      15_000,
      'getBatchNumber'
    )
    currentBatch = unwrap<number>(result)
  } catch {
    // ignore
  }

  const db = indexerDb
  const indexedBatchCount = db ? db.getIndexedBatchCount() : 0
  const gapCount = db && state.lastProcessedBatch > 0
    ? db.getUnindexedBatches(1, state.lastProcessedBatch).length
    : 0

  // Query Neo4j for the real transaction count — SQLite tx_count sums are
  // unreliable because the Neo4j→SQLite migration marked historical batches
  // with tx_count=0 (the per-batch counts were unknown at migration time).
  let totalTransactionsIndexed = 0
  try {
    totalTransactionsIndexed = await readTx(async (tx) => {
      const res = await tx.run('MATCH ()-[t:TRANSACTION]->() RETURN count(t) AS cnt')
      return toNumber(res.records[0]?.get('cnt'))
    })
  } catch {
    // Fallback to SQLite sum if Neo4j is unreachable
    totalTransactionsIndexed = db ? db.getTotalTransactionsIndexed() : 0
  }

  const progress = currentBatch > 0 && state.lastProcessedBatch >= 0
    ? ((state.lastProcessedBatch / currentBatch) * 100).toFixed(1) + '%'
    : 'unknown'

  return {
    lastProcessedBatch: state.lastProcessedBatch,
    currentBatch,
    backfillProgress: progress,
    liveSubscriptionActive: state.liveSubscriptionActive,
    totalTransactionsIndexed,
    indexedBatchCount,
    gapCount,
    backfillComplete: state.backfillComplete,
    running: state.running,
    skippedBatches: state.skippedBatches.length,
    gapRepairsCompleted: state.gapRepairsCompleted,
    lastGapScanAt: state.lastGapScanAt || null,
  }
}

export function getIndexerDb(): IndexerDb | null {
  return indexerDb
}

export function startBlockchainIndexer(): { stop: () => Promise<void> } {
  ensureRpcClient()
  state.running = true

  // Open SQLite database
  indexerDb = openIndexerDb()
  console.log('[indexer] SQLite indexer database opened')

  console.log('[indexer] Starting blockchain indexer...')

  // Backfill first, then start live subscription to avoid concurrent write pressure
  ;(async () => {
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await runBackfill()
        break
      } catch (err) {
        console.error(`[indexer] Backfill failed (attempt ${attempt}/${maxAttempts}):`, err)
        if (attempt < maxAttempts && state.running) {
          const delay = 30_000 * attempt
          console.log(`[indexer] Retrying backfill in ${delay / 1000}s...`)
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }

    // Start live subscription only after backfill finishes (or exhausts retries)
    if (state.running) {
      startLiveSubscription().catch((err) => {
        console.error('[indexer] Live subscription startup failed:', err)
      })
    }
  })()

  return {
    stop: async () => {
      console.log('[indexer] Stopping...')
      state.running = false

      if (subscription) {
        try {
          subscription.close()
        } catch {
          // ignore
        }
        subscription = null
      }
      blockProcessingChain = Promise.resolve()

      if (indexerDb) {
        indexerDb.close()
        indexerDb = null
      }

      state.liveSubscriptionActive = false
      state.lastGapScanAt = 0
      state.gapRepairsCompleted = 0
      console.log('[indexer] Stopped')
    },
  }
}


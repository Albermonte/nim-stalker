import { type Block, type Subscription, BlockType } from '@albermonte/nimiq-rpc-client-ts'
import { ensureRpcClient, getRpcClient, mapTransaction } from './rpc-client'
import { rebuildAllEdgeAggregates, writeTransactionBatch, updateEdgeAggregatesForPairs, markBackfilledAddressesComplete } from './indexing'
import { readTx, writeTx } from '../lib/neo4j'
import { config } from '../lib/config'

const META_KEY = 'indexer'

interface IndexerState {
  lastProcessedBatch: number
  liveSubscriptionActive: boolean
  totalTransactionsIndexed: number
  running: boolean
  backfillComplete: boolean
}

const state: IndexerState = {
  lastProcessedBatch: -1,
  liveSubscriptionActive: false,
  totalTransactionsIndexed: 0,
  running: false,
  backfillComplete: false,
}

let subscription: Subscription<Block> | null = null

interface BackfillTuning {
  checkpointInterval: number
  throttleMs: number
  throttleEveryBatches: number
  deferAggregates: boolean
}

// --- Meta node helpers ---

async function getLastProcessedBatch(): Promise<number> {
  return readTx(async (tx) => {
    const result = await tx.run(
      `MATCH (m:Meta {key: $key}) RETURN m.lastProcessedBatch AS batch`,
      { key: META_KEY }
    )
    if (result.records.length === 0) return -1
    const val = result.records[0].get('batch')
    return typeof val === 'number' ? val : Number(val)
  })
}

async function persistCheckpoint(batch: number, totalIndexedDelta: number): Promise<void> {
  await writeTx(async (tx) => {
    await tx.run(
      `MERGE (m:Meta {key: $key})
       SET m.lastProcessedBatch = $batch, m.updatedAt = $now,
           m.totalTransactionsIndexed = coalesce(m.totalTransactionsIndexed, 0) + $delta`,
      { key: META_KEY, batch, now: new Date().toISOString(), delta: totalIndexedDelta }
    )
  })
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

export function shouldPersistBackfillCheckpoint(
  batch: number,
  startBatch: number,
  currentBatch: number,
  checkpointInterval: number
): boolean {
  if (batch === currentBatch) return true
  if (checkpointInterval <= 1) return true
  return (batch - startBatch + 1) % checkpointInterval === 0
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

function unwrap<T>(result: { data?: T; error?: { code: number; message: string } }): T {
  const { data, error } = result
  if (error) {
    throw new Error(error.message ?? 'RPC call failed')
  }
  return data as T
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
      const result = await client.blockchain.getBatchNumber()
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

// --- Backfill worker ---

async function runBackfill(): Promise<void> {
  await waitForConsensus()

  const tuning = parseBackfillTuning(process.env)
  state.lastProcessedBatch = await getLastProcessedBatch()
  const startBatch = Math.max(1, state.lastProcessedBatch + 1)

  const currentBatch = await waitForRpc()
  const client = getRpcClient()

  if (startBatch > currentBatch) {
    console.log(`[backfill] Already caught up (batch ${state.lastProcessedBatch}/${currentBatch})`)
    return
  }

  console.log(`[backfill] Starting from batch ${startBatch} to ${currentBatch} (${currentBatch - startBatch + 1} batches)`)
  console.log(
    `[backfill] Tuning checkpointEvery=${tuning.checkpointInterval}, throttle=${tuning.throttleMs}ms/${tuning.throttleEveryBatches} batches, deferAggregates=${tuning.deferAggregates}`
  )

  const backfillStartMs = Date.now()
  let aggregateRebuildNeeded = false
  let pendingIndexedDelta = 0
  let consecutiveErrors = 0

  for (let batch = startBatch; batch <= currentBatch; batch++) {
    if (!state.running) {
      if (state.lastProcessedBatch >= startBatch) {
        await persistCheckpoint(state.lastProcessedBatch, pendingIndexedDelta)
        pendingIndexedDelta = 0
      }
      console.log('[backfill] Stopped')
      return
    }

    try {
      const result = await client.blockchain.getTransactionsByBatchNumber(batch)
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
          state.totalTransactionsIndexed += writeResult.count
          pendingIndexedDelta += writeResult.count
        }
      }

      consecutiveErrors = 0
      state.lastProcessedBatch = batch
      const shouldPersist = shouldPersistBackfillCheckpoint(
        batch,
        startBatch,
        currentBatch,
        tuning.checkpointInterval
      )
      const isFinalBatch = batch === currentBatch
      if (shouldPersist && (!isFinalBatch || !tuning.deferAggregates)) {
        await persistCheckpoint(batch, pendingIndexedDelta)
        pendingIndexedDelta = 0
      }

      if (batch % 100 === 0) {
        const processedBatches = batch - startBatch + 1
        const remainingBatches = currentBatch - batch
        const etaMs = estimateBackfillEtaMs(processedBatches, remainingBatches, Date.now() - backfillStartMs)
        const progress = ((processedBatches / (currentBatch - startBatch + 1)) * 100).toFixed(1)
        console.log(`[backfill] Batch ${batch}/${currentBatch} (${progress}%, ETA ${formatEta(etaMs)})`)
      }

      // Small delay to avoid overwhelming the RPC node
      if (tuning.throttleMs > 0 && batch % tuning.throttleEveryBatches === 0) {
        await new Promise((r) => setTimeout(r, tuning.throttleMs))
      }
    } catch (error) {
      consecutiveErrors++
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[backfill] Error processing batch ${batch}:`, msg)
      // Exponential backoff: 5s, 10s, 20s, 40s, capped at 60s
      const delay = Math.min(5000 * 2 ** (consecutiveErrors - 1), 60_000)
      console.log(`[backfill] Retrying in ${delay / 1000}s (attempt ${consecutiveErrors})`)
      await new Promise((r) => setTimeout(r, delay))
      // Retry same batch
      batch--
    }
  }

  if (tuning.deferAggregates && aggregateRebuildNeeded) {
    console.log('[backfill] Rebuilding TRANSACTED_WITH aggregates after backfill...')
    await rebuildAllEdgeAggregates()
    console.log('[backfill] Aggregate rebuild complete')
  }

  await persistCheckpoint(state.lastProcessedBatch, pendingIndexedDelta)
  pendingIndexedDelta = 0
  await markBackfilledAddressesComplete()
  state.backfillComplete = true
  console.log(`[backfill] Complete — processed up to batch ${state.lastProcessedBatch}`)
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

    subscription.next(async (response) => {
      if (response.error) {
        console.error('[live] Stream error:', response.error.message)
        return
      }

      const block = response.data
      const transactions = block.transactions ?? []

      // Track batch progress from macro blocks (each macro block closes a batch)
      if (block.type === BlockType.Macro && state.backfillComplete) {
        const completedBatch = block.batch - 1
        if (completedBatch > state.lastProcessedBatch) {
          state.lastProcessedBatch = completedBatch
          await persistCheckpoint(completedBatch, 0).catch((err) => {
            console.error('[live] Failed to persist batch checkpoint:', err)
          })
        }
      }

      if (transactions.length === 0) return

      try {
        const txs = transactions.map(mapTransaction)
        const writeResult = await writeTransactionBatch(txs)

        if (writeResult.count > 0) {
          const pairs = extractPairs(txs)
          await updateEdgeAggregatesForPairs(pairs)
          state.totalTransactionsIndexed += writeResult.count
          await persistCheckpoint(state.lastProcessedBatch, writeResult.count)
        }

        console.log(`[live] Block #${block.number}: ${writeResult.count} transactions indexed`)
      } catch (error) {
        console.error(`[live] Error processing block #${block.number}:`, error instanceof Error ? error.message : error)
      }
    })

    state.liveSubscriptionActive = true
    console.log('[live] Subscribed to head blocks')
  } catch (error) {
    console.error('[live] Failed to start subscription:', error instanceof Error ? error.message : error)
    state.liveSubscriptionActive = false
  }
}

// --- Public API ---

export function getIndexerStatus() {
  return {
    lastProcessedBatch: state.lastProcessedBatch,
    liveSubscriptionActive: state.liveSubscriptionActive,
    totalTransactionsIndexed: state.totalTransactionsIndexed,
    running: state.running,
  }
}

export async function getIndexerStatusWithProgress() {
  let currentBatch = 0
  try {
    const client = getRpcClient()
    const result = await client.blockchain.getBatchNumber()
    currentBatch = unwrap<number>(result)
  } catch {
    // ignore
  }

  const progress = currentBatch > 0 && state.lastProcessedBatch >= 0
    ? ((state.lastProcessedBatch / currentBatch) * 100).toFixed(1) + '%'
    : 'unknown'

  return {
    lastProcessedBatch: state.lastProcessedBatch,
    currentBatch,
    backfillProgress: progress,
    liveSubscriptionActive: state.liveSubscriptionActive,
    totalTransactionsIndexed: state.totalTransactionsIndexed,
    running: state.running,
  }
}

export function startBlockchainIndexer(): { stop: () => Promise<void> } {
  ensureRpcClient()
  state.running = true

  console.log('[indexer] Starting blockchain indexer...')

  // Mark any backfilled addresses missing indexStatus (self-healing)
  markBackfilledAddressesComplete().catch((err) => {
    console.error('[indexer] Failed to mark backfilled addresses:', err)
  })

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

      state.liveSubscriptionActive = false
      console.log('[indexer] Stopped')
    },
  }
}

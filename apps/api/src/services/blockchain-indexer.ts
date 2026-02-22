import { type Block, type Subscription, BlockType } from '@albermonte/nimiq-rpc-client-ts'
import { ensureRpcClient, getRpcClient, mapTransaction, unwrap } from './rpc-client'
import { type AggregateDelta, rebuildAllEdgeAggregates, writeTransactionBatch, updateEdgeAggregatesFromDeltas, markBackfilledAddressesComplete, updateAddressBalances } from './indexing'
import { readTx, toNumber } from '../lib/neo4j'
import { config } from '../lib/config'
import { openIndexerDb, type IndexerDb } from '../lib/indexer-db'
import { withTimeout, poolAll } from '../lib/concurrency'
import { formatAddress } from '../lib/address-utils'

const MAX_CONSECUTIVE_ERRORS = 10
const BACKFILL_CHECKPOINT_KEY = 'backfill_checkpoint'

interface IndexerState {
  lastProcessedBatch: number
  lastVerifiedContiguousBatch: number
  lastLiveBlockSeen: number | null
  pendingLiveBlocks: number
  liveSubscriptionActive: boolean
  running: boolean
  backfillComplete: boolean
  skippedBatches: number[]
  lastGapScanAt: number
  gapRepairsCompleted: number
}

const state: IndexerState = {
  lastProcessedBatch: -1,
  lastVerifiedContiguousBatch: -1,
  lastLiveBlockSeen: null,
  pendingLiveBlocks: 0,
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
let gapRepairTimer: ReturnType<typeof setInterval> | null = null
const deferredAggregatePairs = new Map<string, AggregateDelta>()
let deferredAggregateFlushTimer: ReturnType<typeof setTimeout> | null = null
let deferredAggregateFlushInFlight = false
let deferredAggregateFlushBackoffMs = 1_000

interface BackfillTuning {
  checkpointInterval: number
  throttleMs: number
  throttleEveryBatches: number
  deferAggregates: boolean
  rpcPrefetch: number
}

interface BackfillCheckpoint {
  lastAttemptedBatch: number
  lastSuccessfulBatch: number
  updatedAt: string
}

// --- Helpers ---

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

function normalizeBatch(batch: number): number {
  return batch < 1 ? -1 : batch
}

function nextBatchAfterContiguous(batch: number): number {
  return batch < 1 ? 1 : batch + 1
}

function readBackfillCheckpoint(db: IndexerDb): BackfillCheckpoint | null {
  const raw = db.getMeta(BACKFILL_CHECKPOINT_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<BackfillCheckpoint>
    const lastAttemptedBatch = Number(parsed.lastAttemptedBatch)
    const lastSuccessfulBatch = Number(parsed.lastSuccessfulBatch)
    const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : ''

    if (!Number.isFinite(lastAttemptedBatch) || !Number.isFinite(lastSuccessfulBatch) || !updatedAt) {
      return null
    }

    return {
      lastAttemptedBatch: Math.max(0, Math.floor(lastAttemptedBatch)),
      lastSuccessfulBatch: Math.max(0, Math.floor(lastSuccessfulBatch)),
      updatedAt,
    }
  } catch {
    return null
  }
}

function persistBackfillCheckpoint(db: IndexerDb, lastAttemptedBatch: number, lastSuccessfulBatch: number): void {
  const checkpoint: BackfillCheckpoint = {
    lastAttemptedBatch: Math.max(0, Math.floor(lastAttemptedBatch)),
    lastSuccessfulBatch: Math.max(0, Math.floor(lastSuccessfulBatch)),
    updatedAt: new Date().toISOString(),
  }
  db.setMeta(BACKFILL_CHECKPOINT_KEY, JSON.stringify(checkpoint))
}

function advanceContiguousFromCurrent(db: IndexerDb): void {
  let next = nextBatchAfterContiguous(state.lastVerifiedContiguousBatch)
  while (db.isBatchIndexed(next)) {
    state.lastVerifiedContiguousBatch = next
    next += 1
  }
}

function advanceContiguousToUpperBound(db: IndexerDb, upperBound: number): void {
  if (upperBound < 1) {
    state.lastVerifiedContiguousBatch = -1
    return
  }

  const start = nextBatchAfterContiguous(state.lastVerifiedContiguousBatch)
  if (start > upperBound) return

  const firstGap = db.getFirstUnindexedBatch(start, upperBound)
  if (firstGap == null) {
    state.lastVerifiedContiguousBatch = upperBound
  } else {
    state.lastVerifiedContiguousBatch = normalizeBatch(firstGap - 1)
  }
}

function recomputeContiguousFromStart(db: IndexerDb, upperBound: number): void {
  if (upperBound < 1) {
    state.lastVerifiedContiguousBatch = -1
    return
  }

  const firstGap = db.getFirstUnindexedBatch(1, upperBound)
  if (firstGap == null) {
    state.lastVerifiedContiguousBatch = upperBound
  } else {
    state.lastVerifiedContiguousBatch = normalizeBatch(firstGap - 1)
  }
}

async function fetchBatchTransactions(client: ReturnType<typeof getRpcClient>, batch: number): Promise<any[]> {
  const result = await withTimeout(
    client.blockchain.getTransactionsByBatchNumber(batch),
    30_000,
    `getTransactionsByBatchNumber(${batch})`
  )
  return unwrap<any[]>(result)
}

async function indexRawBatchTransactions(
  db: IndexerDb,
  rawTxs: any[],
  batch: number,
  deferAggregates: boolean
): Promise<{ aggregateRebuildNeeded: boolean }> {
  if (rawTxs && rawTxs.length > 0) {
    const txs = rawTxs.map(mapTransaction)
    const writeResult = await writeTransactionBatch(txs)

    let aggregateRebuildNeeded = false
    if (writeResult.aggregateDeltas.length > 0) {
      if (deferAggregates) {
        aggregateRebuildNeeded = true
      } else {
        await updateEdgeAggregatesFromDeltas(writeResult.aggregateDeltas)
      }
    }

    db.markBatchIndexed(batch, writeResult.count)
    return { aggregateRebuildNeeded }
  }

  db.markBatchIndexed(batch, 0)
  return { aggregateRebuildNeeded: false }
}

function getTransitionBudgetMs(env: Record<string, string | undefined>): number {
  return parsePositiveInt(env.LIVE_TRANSITION_GAP_BUDGET_MS, 5_000)
}

function shouldDeferVerifyBatchAggregates(env: Record<string, string | undefined>): boolean {
  return parseBoolean(env.VERIFY_BATCH_DEFER_AGGREGATES, true)
}

function shouldDeferLiveAggregates(env: Record<string, string | undefined>): boolean {
  return parseBoolean(env.LIVE_DEFER_AGGREGATES, true)
}

function getVerifyBatchAggregatePairBatchSize(env: Record<string, string | undefined>): number {
  return parsePositiveInt(env.VERIFY_BATCH_AGGREGATE_PAIR_BATCH_SIZE, 5)
}

function getVerifyBatchAggregateFlushLimit(env: Record<string, string | undefined>): number {
  return parsePositiveInt(env.VERIFY_BATCH_AGGREGATE_FLUSH_LIMIT, 50)
}

function getVerifyBatchAggregateFlushTickMs(env: Record<string, string | undefined>): number {
  return parseNonNegativeInt(env.VERIFY_BATCH_AGGREGATE_FLUSH_TICK_MS, 1_000)
}

function queueDeferredAggregatePairs(deltas: AggregateDelta[]): number {
  for (const delta of deltas) {
    const key = `${delta.from}->${delta.to}`
    const current = deferredAggregatePairs.get(key)
    if (current) {
      current.txCount += delta.txCount
      current.totalValue = (BigInt(current.totalValue) + BigInt(delta.totalValue)).toString()
      if (delta.firstTxAt < current.firstTxAt) current.firstTxAt = delta.firstTxAt
      if (delta.lastTxAt > current.lastTxAt) current.lastTxAt = delta.lastTxAt
    } else {
      deferredAggregatePairs.set(key, { ...delta })
    }
  }
  return deferredAggregatePairs.size
}

async function flushDeferredAggregatePairs(maxPairs?: number): Promise<boolean> {
  if (deferredAggregatePairs.size === 0) return true

  const pairBatchSize = getVerifyBatchAggregatePairBatchSize(process.env)
  const limit = maxPairs ?? getVerifyBatchAggregateFlushLimit(process.env)
  const entries = Array.from(deferredAggregatePairs.entries()).slice(0, limit)
  if (entries.length === 0) return true

  console.log(`[gap-repair] Flushing deferred aggregates for ${entries.length} pairs...`)

  for (let i = 0; i < entries.length; i += pairBatchSize) {
    const chunk = entries.slice(i, i + pairBatchSize)
    try {
      await updateEdgeAggregatesFromDeltas(chunk.map(([, delta]) => delta))
      for (const [key] of chunk) {
        deferredAggregatePairs.delete(key)
      }
    } catch (error) {
      console.warn(`[gap-repair] Deferred aggregate flush failed: ${error instanceof Error ? error.message : error}`)
      return false
    }
  }

  return true
}

function stopDeferredAggregateFlush(): void {
  if (deferredAggregateFlushTimer) {
    clearTimeout(deferredAggregateFlushTimer)
    deferredAggregateFlushTimer = null
  }
  deferredAggregateFlushBackoffMs = getVerifyBatchAggregateFlushTickMs(process.env)
}

function scheduleDeferredAggregateFlush(delayMs = 0): void {
  if (!state.running || deferredAggregatePairs.size === 0) return
  if (deferredAggregateFlushInFlight || deferredAggregateFlushTimer) return

  const tickMs = Math.max(delayMs, getVerifyBatchAggregateFlushTickMs(process.env))
  deferredAggregateFlushTimer = setTimeout(() => {
    deferredAggregateFlushTimer = null

    void (async () => {
      if (!state.running || deferredAggregatePairs.size === 0 || deferredAggregateFlushInFlight) return

      deferredAggregateFlushInFlight = true
      const before = deferredAggregatePairs.size
      let flushed = false
      try {
        flushed = await flushDeferredAggregatePairs(getVerifyBatchAggregateFlushLimit(process.env))
      } finally {
        deferredAggregateFlushInFlight = false
      }

      const after = deferredAggregatePairs.size
      if (after > 0 && state.running) {
        if (!flushed) {
          deferredAggregateFlushBackoffMs = Math.min(deferredAggregateFlushBackoffMs * 2, 300_000)
          console.warn(`[gap-repair] Deferred aggregate flush retry in ${deferredAggregateFlushBackoffMs}ms`)
          scheduleDeferredAggregateFlush(deferredAggregateFlushBackoffMs)
          return
        }

        deferredAggregateFlushBackoffMs = getVerifyBatchAggregateFlushTickMs(process.env)
        if (after === before) {
          console.warn(`[gap-repair] Deferred aggregate queue unchanged (${after} pairs), will retry`)
        } else {
          console.log(`[gap-repair] Deferred aggregate queue remaining: ${after} pairs`)
        }
        scheduleDeferredAggregateFlush()
      } else {
        deferredAggregateFlushBackoffMs = getVerifyBatchAggregateFlushTickMs(process.env)
      }
    })()
  }, tickMs)
}

export function parseBackfillTuning(env: Record<string, string | undefined>): BackfillTuning {
  return {
    checkpointInterval: parsePositiveInt(env.BACKFILL_CHECKPOINT_INTERVAL, 100),
    throttleMs: parseNonNegativeInt(env.BACKFILL_THROTTLE_MS, 0),
    throttleEveryBatches: parsePositiveInt(env.BACKFILL_THROTTLE_EVERY_BATCHES, 10),
    deferAggregates: parseBoolean(env.BACKFILL_DEFER_AGGREGATES, true),
    rpcPrefetch: parsePositiveInt(env.BACKFILL_RPC_PREFETCH, 4),
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

// --- Backfill worker ---

async function runBackfill(): Promise<void> {
  await waitForConsensus()

  const tuning = parseBackfillTuning(process.env)
  const db = indexerDb!
  const client = getRpcClient()

  // Self-healing: mark backfilled addresses from prior runs
  await markBackfilledAddressesComplete()

  state.lastProcessedBatch = db.getLastIndexedBatch()
  recomputeContiguousFromStart(db, state.lastProcessedBatch)
  let currentBatch = await waitForRpc()

  if (state.lastProcessedBatch >= currentBatch) {
    console.log(`[backfill] Already caught up (batch ${state.lastProcessedBatch}/${currentBatch})`)
    state.backfillComplete = true
    persistBackfillCheckpoint(db, state.lastProcessedBatch, state.lastProcessedBatch)
    return
  }

  const totalGapCount = db.getGapCount(1, currentBatch)
  if (totalGapCount === 0) {
    console.log(`[backfill] No gaps found — fully indexed up to batch ${currentBatch}`)
    state.lastProcessedBatch = db.getLastIndexedBatch()
    recomputeContiguousFromStart(db, state.lastProcessedBatch)
    state.backfillComplete = true
    persistBackfillCheckpoint(db, state.lastProcessedBatch, state.lastProcessedBatch)
    return
  }

  const firstGap = db.getFirstUnindexedBatch(1, currentBatch) ?? 1
  const checkpoint = readBackfillCheckpoint(db)
  let gapCursor = firstGap - 1
  if (checkpoint && checkpoint.lastSuccessfulBatch < firstGap) {
    gapCursor = checkpoint.lastSuccessfulBatch
  }

  console.log(`[backfill] ${totalGapCount} unindexed batches to process (1..${currentBatch})`)
  console.log(
    `[backfill] Tuning prefetch=${tuning.rpcPrefetch}, throttle=${tuning.throttleMs}ms/${tuning.throttleEveryBatches} batches, deferAggregates=${tuning.deferAggregates}`
  )
  if (checkpoint) {
    console.log(`[backfill] Resuming from checkpoint attempted=${checkpoint.lastAttemptedBatch} successful=${checkpoint.lastSuccessfulBatch}`)
  }

  const backfillStartMs = Date.now()
  const syntheticEndBatch = firstGap + totalGapCount - 1
  let aggregateRebuildNeeded = false
  let consecutiveErrors = 0
  let processedCount = 0
  let throttleCounter = 0

  const onIndexedBatch = async (batch: number, countTowardsProgress: boolean): Promise<void> => {
    state.lastProcessedBatch = db.getLastIndexedBatch()
    advanceContiguousFromCurrent(db)

    throttleCounter += 1

    if (countTowardsProgress) {
      processedCount += 1
      if (processedCount % 100 === 0) {
        const remainingBatches = Math.max(0, totalGapCount - processedCount)
        const etaMs = estimateBackfillEtaMs(processedCount, remainingBatches, Date.now() - backfillStartMs)
        const progress = ((processedCount / totalGapCount) * 100).toFixed(1)
        console.log(`[backfill] ${processedCount}/${totalGapCount} batches (${progress}%, ETA ${formatEta(etaMs)})`)
      }

      const syntheticBatch = firstGap + processedCount - 1
      if (shouldPersistBackfillCheckpoint(syntheticBatch, firstGap, syntheticEndBatch, tuning.checkpointInterval)) {
        persistBackfillCheckpoint(db, batch, state.lastProcessedBatch)
      }
    }

    if (tuning.throttleMs > 0 && throttleCounter % tuning.throttleEveryBatches === 0) {
      await new Promise((r) => setTimeout(r, tuning.throttleMs))
    }
  }

  const processGapPage = async (gapPage: number[], countTowardsProgress: boolean): Promise<void> => {
    const prefetched = gapPage.map((batch) => ({
      batch,
      promise: fetchBatchTransactions(client, batch),
    }))

    for (const item of prefetched) {
      if (!state.running) return

      let rawTxs: any[] | null = null
      let pendingError: unknown | null = null

      try {
        rawTxs = await item.promise
      } catch (error) {
        pendingError = error
      }

      let done = false
      while (!done) {
        if (!pendingError) {
          const indexed = await indexRawBatchTransactions(db, rawTxs ?? [], item.batch, tuning.deferAggregates)
          if (indexed.aggregateRebuildNeeded) {
            aggregateRebuildNeeded = true
          }
          consecutiveErrors = 0
          await onIndexedBatch(item.batch, countTowardsProgress)
          done = true
          continue
        }

        consecutiveErrors += 1
        const msg = pendingError instanceof Error ? pendingError.message : String(pendingError)

        if (isNotFoundError(msg)) {
          console.warn(`[backfill] Batch ${item.batch} not found, treating as empty`)
          db.markBatchIndexed(item.batch, 0)
          consecutiveErrors = 0
          await onIndexedBatch(item.batch, countTowardsProgress)
          done = true
          continue
        }

        console.error(`[backfill] Error processing batch ${item.batch}:`, msg)

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.error(`[backfill] ${MAX_CONSECUTIVE_ERRORS} consecutive errors — skipping batch ${item.batch}`)
          state.skippedBatches.push(item.batch)
          consecutiveErrors = 0
          done = true
          continue
        }

        const delay = Math.min(5000 * 2 ** (consecutiveErrors - 1), 60_000)
        console.log(`[backfill] Retrying in ${delay / 1000}s (attempt ${consecutiveErrors})`)
        await new Promise((r) => setTimeout(r, delay))

        try {
          rawTxs = await fetchBatchTransactions(client, item.batch)
          pendingError = null
        } catch (error) {
          pendingError = error
        }
      }

      gapCursor = item.batch
    }
  }

  while (state.running) {
    const gapPage = db.getUnindexedBatchesPage(1, currentBatch, Math.max(1, tuning.rpcPrefetch), gapCursor)
    if (gapPage.length === 0) break
    await processGapPage(gapPage, true)
  }

  if (!state.running) {
    state.lastProcessedBatch = db.getLastIndexedBatch()
    recomputeContiguousFromStart(db, state.lastProcessedBatch)
    console.log('[backfill] Stopped')
    return
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
      const newGapCount = db.getGapCount(currentBatch + 1, latestBatch)
      if (newGapCount === 0) {
        caughtUp = true
        break
      }

      console.log(`[backfill] ${newGapCount} new batches arrived during backfill, processing...`)
      let trailingCursor = currentBatch
      while (state.running) {
        const page = db.getUnindexedBatchesPage(
          currentBatch + 1,
          latestBatch,
          Math.max(1, tuning.rpcPrefetch),
          trailingCursor
        )
        if (page.length === 0) break
        await processGapPage(page, false)
        trailingCursor = page[page.length - 1]
      }

      currentBatch = latestBatch
    } catch (err) {
      console.warn('[backfill] Failed to check for newer batches:', err instanceof Error ? err.message : err)
      caughtUp = true // Exit loop on RPC failure, gap repair loop will handle the rest
    }
  }

  if (tuning.deferAggregates && aggregateRebuildNeeded) {
    console.log('[backfill] Rebuilding TRANSACTED_WITH aggregates after backfill...')
    await rebuildAllEdgeAggregates()
    console.log('[backfill] Aggregate rebuild complete')
  }

  await markBackfilledAddressesComplete()
  state.lastProcessedBatch = db.getLastIndexedBatch()
  recomputeContiguousFromStart(db, state.lastProcessedBatch)
  state.backfillComplete = true
  persistBackfillCheckpoint(db, state.lastProcessedBatch, state.lastProcessedBatch)

  if (state.skippedBatches.length > 0) {
    console.warn(`[backfill] Complete with ${state.skippedBatches.length} skipped batches: ${state.skippedBatches.slice(0, 20).join(', ')}${state.skippedBatches.length > 20 ? '...' : ''}`)
  } else {
    console.log(`[backfill] Complete — processed up to batch ${state.lastProcessedBatch}`)
  }
}

// --- Live subscription ---

function scheduleGapRepair(client: ReturnType<typeof getRpcClient>): void {
  if (!state.running || !state.backfillComplete) return
  blockProcessingChain = blockProcessingChain
    .then(() => repairGaps(client))
    .catch((err) => {
      console.error('[gap-repair] Scheduled cycle failed:', err instanceof Error ? err.message : err)
    })
}

function startGapRepairLoop(client: ReturnType<typeof getRpcClient>): void {
  if (gapRepairTimer) {
    clearInterval(gapRepairTimer)
    gapRepairTimer = null
  }

  const gapConfig = parseGapRepairConfig(process.env)
  gapRepairTimer = setInterval(() => {
    scheduleGapRepair(client)
  }, gapConfig.intervalMs)
}

function stopGapRepairLoop(): void {
  if (!gapRepairTimer) return
  clearInterval(gapRepairTimer)
  gapRepairTimer = null
}

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
      const txCount = block.transactions?.length ?? 0
      state.pendingLiveBlocks += 1

      if (txCount > 0) {
        console.log(`[live] Head block #${block.number} received with ${txCount} tx(s) (queue=${state.pendingLiveBlocks})`)
      }

      blockProcessingChain = blockProcessingChain
        .then(() => processLiveBlock(block, client))
        .catch((error) => {
          console.error(`[live] Error processing block #${block.number}:`, error instanceof Error ? error.message : error)
        })
        .finally(() => {
          state.pendingLiveBlocks = Math.max(0, state.pendingLiveBlocks - 1)
        })
    })

    state.liveSubscriptionActive = true
    console.log('[live] Subscribed to head blocks')

    startGapRepairLoop(client)
    scheduleGapRepair(client)
  } catch (error) {
    console.error('[live] Failed to start subscription:', error instanceof Error ? error.message : error)
    state.liveSubscriptionActive = false
  }
}

async function processTransitionContinuity(
  completedBatch: number,
  client: ReturnType<typeof getRpcClient>
): Promise<void> {
  const db = indexerDb
  if (!db || completedBatch < 1) return

  advanceContiguousToUpperBound(db, completedBatch)
  if (state.lastVerifiedContiguousBatch >= completedBatch) return

  const budgetMs = getTransitionBudgetMs(process.env)
  const deadline = Date.now() + budgetMs

  while (state.running && Date.now() < deadline) {
    const nextMissing = nextBatchAfterContiguous(state.lastVerifiedContiguousBatch)
    if (nextMissing > completedBatch) break

    try {
      await verifyBatch(nextMissing, client)
    } catch (err) {
      console.warn(`[live] Failed transition gap batch ${nextMissing}: ${err instanceof Error ? err.message : err}`)
      break
    }

    advanceContiguousToUpperBound(db, completedBatch)
    if (state.lastVerifiedContiguousBatch >= completedBatch) break
  }

  advanceContiguousToUpperBound(db, completedBatch)
  if (state.lastVerifiedContiguousBatch < completedBatch) {
    const remaining = completedBatch - state.lastVerifiedContiguousBatch
    console.warn(`[live] Continuity budget exhausted with ${remaining} unverified contiguous batches pending`)
  }
}

async function processLiveBlock(block: Block, client: ReturnType<typeof getRpcClient>): Promise<void> {
  state.lastLiveBlockSeen = block.number

  // When a macro block closes a batch, verify contiguous batch coverage.
  if (block.type === BlockType.Macro && state.backfillComplete && indexerDb) {
    const completedBatch = block.batch - 1
    if (completedBatch > state.lastVerifiedContiguousBatch) {
      await processTransitionContinuity(completedBatch, client)
    }
  }

  const transactions = block.transactions ?? []
  if (transactions.length === 0) return

  const txs = transactions.map(mapTransaction)
  const writeResult = await writeTransactionBatch(txs)
  let queuedCount: number | null = null

  if (writeResult.aggregateDeltas.length > 0) {
    if (shouldDeferLiveAggregates(process.env)) {
      queuedCount = queueDeferredAggregatePairs(writeResult.aggregateDeltas)
      scheduleDeferredAggregateFlush()
    } else {
      await updateEdgeAggregatesFromDeltas(writeResult.aggregateDeltas)
    }

    // Balance updates — awaited to prevent concurrent pool pressure
    const uniqueAddresses = [...new Set(txs.flatMap(tx => [tx.from, tx.to]))]
    await fetchAndUpdateBalances(client, uniqueAddresses)
  }

  if (queuedCount != null) {
    console.log(`[live] Block #${block.number}: ${writeResult.insertedCount} transactions indexed (aggregates deferred, queued pairs=${queuedCount})`)
  } else {
    console.log(`[live] Block #${block.number}: ${writeResult.insertedCount} transactions indexed`)
  }
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

async function verifyBatch(batch: number, client: ReturnType<typeof getRpcClient>): Promise<boolean> {
  const db = indexerDb
  if (!db) return false

  if (db.isBatchIndexed(batch)) {
    return false
  }

  try {
    const rawTxs = await fetchBatchTransactions(client, batch)
    console.log(`[live] Verifying batch ${batch}: fetched ${rawTxs.length} tx(s)`)

    if (rawTxs && rawTxs.length > 0) {
      const txs = rawTxs.map(mapTransaction)
      const writeResult = await writeTransactionBatch(txs)

      if (writeResult.aggregateDeltas.length > 0) {
        if (shouldDeferVerifyBatchAggregates(process.env)) {
          const queuedCount = queueDeferredAggregatePairs(writeResult.aggregateDeltas)
          console.log(`[live] Batch ${batch} verified: ${writeResult.insertedCount} new transactions indexed (aggregates deferred, queued pairs=${queuedCount})`)
          scheduleDeferredAggregateFlush()
        } else {
          await updateEdgeAggregatesFromDeltas(writeResult.aggregateDeltas)
          console.log(`[live] Batch ${batch} verified: ${writeResult.insertedCount} new transactions indexed`)
        }
      }

      db.markBatchIndexed(batch, txs.filter(tx => tx.from && tx.to).length)
      if (writeResult.insertedCount === 0) {
        console.log(`[live] Batch ${batch} verification completed with 0 new tx (already indexed or deduped)`)
      }
    } else {
      db.markBatchIndexed(batch, 0)
      console.log(`[live] Batch ${batch} verification completed with no transactions`)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (isNotFoundError(msg)) {
      db.markBatchIndexed(batch, 0)
      return true
    }
    throw error
  }

  state.lastProcessedBatch = db.getLastIndexedBatch()
  return true
}

async function repairGaps(client: ReturnType<typeof getRpcClient>): Promise<void> {
  const db = indexerDb
  if (!db || !state.running || !state.backfillComplete) return

  const gapConfig = parseGapRepairConfig(process.env)

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

  state.lastGapScanAt = Date.now()

  const start = nextBatchAfterContiguous(state.lastVerifiedContiguousBatch)
  if (start > currentBatch) {
    return
  }

  const pendingGapCount = db.getGapCount(start, currentBatch)
  if (pendingGapCount === 0) {
    state.lastVerifiedContiguousBatch = currentBatch
    return
  }

  const toProcess = db.getUnindexedBatchesPage(start, currentBatch, gapConfig.maxPerCycle)
  if (toProcess.length === 0) return

  console.log(`[gap-repair] Found ${pendingGapCount} gaps after batch ${start - 1}, processing ${toProcess.length}...`)

  let repaired = 0
  for (const batch of toProcess) {
    if (!state.running) break
    try {
      await verifyBatch(batch, client)
      repaired += 1
    } catch (err) {
      console.warn(`[gap-repair] Failed batch ${batch}: ${err instanceof Error ? err.message : err}`)
    }
  }

  advanceContiguousToUpperBound(db, currentBatch)

  state.gapRepairsCompleted += repaired
  if (repaired > 0) {
    const remaining = Math.max(0, db.getGapCount(nextBatchAfterContiguous(state.lastVerifiedContiguousBatch), currentBatch))
    console.log(`[gap-repair] Repaired ${repaired}/${toProcess.length} gaps (${remaining} remaining)`)
  }

  if (deferredAggregatePairs.size > 0) {
    scheduleDeferredAggregateFlush(0)
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
    lastVerifiedContiguousBatch: state.lastVerifiedContiguousBatch,
    lastLiveBlockSeen: state.lastLiveBlockSeen,
    pendingLiveBlocks: state.pendingLiveBlocks,
    liveSubscriptionActive: state.liveSubscriptionActive,
    totalTransactionsIndexed,
    indexedBatchCount: db ? db.getIndexedBatchCount() : 0,
    running: state.running,
    backfillComplete: state.backfillComplete,
    skippedBatches: state.skippedBatches.length,
    gapRepairsCompleted: state.gapRepairsCompleted,
    deferredAggregatePairs: deferredAggregatePairs.size,
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
    ? db.getGapCount(1, state.lastProcessedBatch)
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

  const verifiedForProgress = Math.max(0, state.lastVerifiedContiguousBatch)
  const progress = currentBatch > 0
    ? ((verifiedForProgress / currentBatch) * 100).toFixed(1) + '%'
    : 'unknown'

  return {
    lastProcessedBatch: state.lastProcessedBatch,
    lastVerifiedContiguousBatch: state.lastVerifiedContiguousBatch,
    lastLiveBlockSeen: state.lastLiveBlockSeen,
    pendingLiveBlocks: state.pendingLiveBlocks,
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
    deferredAggregatePairs: deferredAggregatePairs.size,
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

      stopGapRepairLoop()
      stopDeferredAggregateFlush()

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
      state.lastProcessedBatch = -1
      state.lastVerifiedContiguousBatch = -1
      state.lastLiveBlockSeen = null
      state.pendingLiveBlocks = 0
      state.lastGapScanAt = 0
      state.gapRepairsCompleted = 0
      deferredAggregatePairs.clear()
      console.log('[indexer] Stopped')
    },
  }
}

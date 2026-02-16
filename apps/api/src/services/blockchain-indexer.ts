import type { Block, Subscription } from '@albermonte/nimiq-rpc-client-ts'
import { ensureRpcClient, getRpcClient, mapTransaction } from './rpc-client'
import { writeTransactionBatch, updateEdgeAggregatesForPairs } from './indexing'
import { readTx, writeTx } from '../lib/neo4j'
import { config } from '../lib/config'

const META_KEY = 'indexer'

interface IndexerState {
  lastProcessedBatch: number
  liveSubscriptionActive: boolean
  totalTransactionsIndexed: number
  running: boolean
}

const state: IndexerState = {
  lastProcessedBatch: -1,
  liveSubscriptionActive: false,
  totalTransactionsIndexed: 0,
  running: false,
}

let subscription: Subscription<Block> | null = null

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

async function setLastProcessedBatch(batch: number): Promise<void> {
  await writeTx(async (tx) => {
    await tx.run(
      `MERGE (m:Meta {key: $key})
       SET m.lastProcessedBatch = $batch, m.updatedAt = $now`,
      { key: META_KEY, batch, now: new Date().toISOString() }
    )
  })
}

async function incrementTotalIndexed(count: number): Promise<void> {
  await writeTx(async (tx) => {
    await tx.run(
      `MERGE (m:Meta {key: $key})
       ON CREATE SET m.totalTransactionsIndexed = $count
       ON MATCH SET m.totalTransactionsIndexed = coalesce(m.totalTransactionsIndexed, 0) + $count`,
      { key: META_KEY, count }
    )
  })
}

// --- Helpers ---

function extractPairs(txs: Array<{ from: string; to: string }>): Array<{ from: string; to: string }> {
  return txs.map((tx) => ({ from: tx.from, to: tx.to }))
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

  state.lastProcessedBatch = await getLastProcessedBatch()
  const startBatch = Math.max(1, state.lastProcessedBatch + 1)

  const currentBatch = await waitForRpc()
  const client = getRpcClient()

  if (startBatch > currentBatch) {
    console.log(`[backfill] Already caught up (batch ${state.lastProcessedBatch}/${currentBatch})`)
    return
  }

  console.log(`[backfill] Starting from batch ${startBatch} to ${currentBatch} (${currentBatch - startBatch + 1} batches)`)

  for (let batch = startBatch; batch <= currentBatch; batch++) {
    if (!state.running) {
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
          const pairs = extractPairs(txs)
          await updateEdgeAggregatesForPairs(pairs)
          state.totalTransactionsIndexed += writeResult.count
          await incrementTotalIndexed(writeResult.count)
        }
      }

      state.lastProcessedBatch = batch
      await setLastProcessedBatch(batch)

      if (batch % 100 === 0) {
        console.log(`[backfill] Batch ${batch}/${currentBatch} (${((batch - startBatch + 1) / (currentBatch - startBatch + 1) * 100).toFixed(1)}%)`)
      }

      // Small delay to avoid overwhelming the RPC node
      if (batch % 10 === 0) {
        await new Promise((r) => setTimeout(r, 50))
      }
    } catch (error) {
      console.error(`[backfill] Error processing batch ${batch}:`, error instanceof Error ? error.message : error)
      // Wait before retrying
      await new Promise((r) => setTimeout(r, 5000))
      // Retry same batch
      batch--
    }
  }

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

      if (transactions.length === 0) return

      try {
        const txs = transactions.map(mapTransaction)
        const writeResult = await writeTransactionBatch(txs)

        if (writeResult.count > 0) {
          const pairs = extractPairs(txs)
          await updateEdgeAggregatesForPairs(pairs)
          state.totalTransactionsIndexed += writeResult.count
          await incrementTotalIndexed(writeResult.count)
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

  // Start live subscription immediately (don't wait for backfill)
  startLiveSubscription().catch((err) => {
    console.error('[indexer] Live subscription startup failed:', err)
  })

  // Start backfill in background with retry
  ;(async () => {
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await runBackfill()
        return
      } catch (err) {
        console.error(`[indexer] Backfill failed (attempt ${attempt}/${maxAttempts}):`, err)
        if (attempt < maxAttempts && state.running) {
          const delay = 30_000 * attempt
          console.log(`[indexer] Retrying backfill in ${delay / 1000}s...`)
          await new Promise(r => setTimeout(r, delay))
        }
      }
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

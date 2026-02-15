import type { Block, Subscription } from '@albermonte/nimiq-rpc-client-ts'
import { ensureRpcClient, getRpcClient, mapTransaction } from './rpc-client'
import { writeTransactionBatch, updateEdgeAggregatesForPairs } from './indexing'
import { readTx, writeTx } from '../lib/neo4j'

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

// --- Backfill worker ---

async function runBackfill(): Promise<void> {
  state.lastProcessedBatch = await getLastProcessedBatch()
  const startBatch = Math.max(1, state.lastProcessedBatch + 1)

  const client = getRpcClient()
  const currentBatchResult = await client.blockchain.getBatchNumber()
  const currentBatch = unwrap<number>(currentBatchResult)

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

  // Start backfill in background
  runBackfill().catch((err) => {
    console.error('[indexer] Backfill failed:', err)
  })

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

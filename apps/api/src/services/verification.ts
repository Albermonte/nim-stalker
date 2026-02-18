import neo4j from 'neo4j-driver'
import { readTx, toNumber } from '../lib/neo4j'
import { getRpcClient } from './rpc-client'

const META_KEY = 'indexer'

interface BatchSpotCheckDetail {
  batch: number
  rpcTxCount: number
  dbMatchCount: number
  missingHashes: string[]
  ok: boolean
}

interface AggregateCheckDetail {
  from: string
  to: string
  aggregateTxCount: number
  actualTxCount: number
  ok: boolean
}

export interface VerificationResult {
  status: 'ok' | 'issues_found'
  timestamp: string
  batchCoverage: {
    lastProcessedBatch: number
    currentBatch: number
    coveragePercent: string
    ok: boolean
  }
  transactionCount: {
    dbCount: number
    metaCount: number
    match: boolean
  }
  batchSpotCheck: {
    sampled: number
    passed: number
    failed: number
    details: BatchSpotCheckDetail[]
  }
  blockRange: {
    min: number | null
    max: number | null
    currentBlock: number
  }
  aggregateCheck: {
    sampled: number
    passed: number
    failed: number
    details: AggregateCheckDetail[]
  }
  issues: string[]
}

function unwrap<T>(result: { data?: T; error?: { code: number; message: string } }): T {
  const { data, error } = result
  if (error) {
    throw new Error(error.message ?? 'RPC call failed')
  }
  return data as T
}

function pickRandomBatches(max: number, count: number): number[] {
  if (max < 1) return []
  const actual = Math.min(count, max)
  const picked = new Set<number>()
  while (picked.size < actual) {
    picked.add(Math.floor(Math.random() * max) + 1)
  }
  return Array.from(picked).sort((a, b) => a - b)
}

export async function verifyBackfillIntegrity(sampleSize = 10): Promise<VerificationResult> {
  const issues: string[] = []
  const client = getRpcClient()

  // Check 1 — Batch coverage
  const metaResult = await readTx(async (tx) => {
    const result = await tx.run(
      `MATCH (m:Meta {key: $key}) RETURN m.lastProcessedBatch AS batch, m.totalTransactionsIndexed AS total`,
      { key: META_KEY }
    )
    if (result.records.length === 0) return { lastProcessedBatch: -1, metaTotal: 0 }
    return {
      lastProcessedBatch: toNumber(result.records[0].get('batch')),
      metaTotal: toNumber(result.records[0].get('total')),
    }
  })

  const currentBatch = unwrap<number>(await client.blockchain.getBatchNumber())
  const coveragePercent = currentBatch > 0
    ? ((metaResult.lastProcessedBatch / currentBatch) * 100).toFixed(2)
    : '0'
  const batchCoverageOk = metaResult.lastProcessedBatch >= currentBatch - 2

  if (!batchCoverageOk) {
    issues.push(`Batch coverage gap: processed ${metaResult.lastProcessedBatch} of ${currentBatch} (${coveragePercent}%)`)
  }

  // Check 2 — Total transaction count
  const dbCount = await readTx(async (tx) => {
    const result = await tx.run(`MATCH ()-[t:TRANSACTION]->() RETURN count(t) AS cnt`)
    return toNumber(result.records[0].get('cnt'))
  })

  const txCountMatch = dbCount === metaResult.metaTotal
  if (!txCountMatch) {
    issues.push(`Transaction count mismatch: DB has ${dbCount}, Meta node says ${metaResult.metaTotal}`)
  }

  // Check 3 — Random batch spot-check
  const batchesToCheck = pickRandomBatches(metaResult.lastProcessedBatch, sampleSize)
  const spotCheckDetails: BatchSpotCheckDetail[] = []

  for (const batch of batchesToCheck) {
    const rpcResult = await client.blockchain.getTransactionsByBatchNumber(batch)
    const rpcTxs = unwrap<any[]>(rpcResult)

    if (!rpcTxs || rpcTxs.length === 0) {
      spotCheckDetails.push({ batch, rpcTxCount: 0, dbMatchCount: 0, missingHashes: [], ok: true })
      continue
    }

    const hashes = rpcTxs.map((tx: any) => tx.hash)

    const dbHashes = await readTx(async (tx) => {
      const result = await tx.run(
        `UNWIND $hashes AS h MATCH ()-[t:TRANSACTION {hash: h}]->() RETURN t.hash AS hash`,
        { hashes }
      )
      return result.records.map((r) => r.get('hash') as string)
    })

    const dbHashSet = new Set(dbHashes)
    const missingHashes = hashes.filter((h: string) => !dbHashSet.has(h))
    const ok = missingHashes.length === 0

    if (!ok) {
      issues.push(`Batch ${batch}: missing ${missingHashes.length}/${hashes.length} transactions`)
    }

    spotCheckDetails.push({
      batch,
      rpcTxCount: hashes.length,
      dbMatchCount: dbHashes.length,
      missingHashes,
      ok,
    })
  }

  const spotCheckPassed = spotCheckDetails.filter((d) => d.ok).length
  const spotCheckFailed = spotCheckDetails.filter((d) => !d.ok).length

  // Check 4 — Block number range continuity
  const blockRange = await readTx(async (tx) => {
    const result = await tx.run(
      `MATCH ()-[t:TRANSACTION]->() RETURN min(t.blockNumber) AS minBlock, max(t.blockNumber) AS maxBlock`
    )
    if (result.records.length === 0) return { min: null, max: null }
    return {
      min: toNumber(result.records[0].get('minBlock')),
      max: toNumber(result.records[0].get('maxBlock')),
    }
  })

  const currentBlock = unwrap<number>(await client.blockchain.getBlockNumber())

  // Check 5 — Aggregate consistency sample
  const aggregateSampleSize = Math.min(sampleSize, 10)
  const aggregateDetails: AggregateCheckDetail[] = await readTx(async (tx) => {
    const sampleResult = await tx.run(
      `MATCH (a)-[r:TRANSACTED_WITH]->(b)
       WITH a, b, r, rand() AS rnd
       ORDER BY rnd
       LIMIT $limit
       MATCH (a)-[t:TRANSACTION]->(b)
       WITH a.id AS fromId, b.id AS toId, r.txCount AS aggCount, count(t) AS realCount
       RETURN fromId, toId, aggCount, realCount`,
      { limit: neo4j.int(aggregateSampleSize) }
    )

    return sampleResult.records.map((r) => {
      const aggCount = toNumber(r.get('aggCount'))
      const realCount = toNumber(r.get('realCount'))
      return {
        from: r.get('fromId') as string,
        to: r.get('toId') as string,
        aggregateTxCount: aggCount,
        actualTxCount: realCount,
        ok: aggCount === realCount,
      }
    })
  })

  for (const detail of aggregateDetails) {
    if (!detail.ok) {
      issues.push(`Aggregate mismatch ${detail.from} → ${detail.to}: TRANSACTED_WITH.txCount=${detail.aggregateTxCount}, actual=${detail.actualTxCount}`)
    }
  }

  const aggPassed = aggregateDetails.filter((d) => d.ok).length
  const aggFailed = aggregateDetails.filter((d) => !d.ok).length

  return {
    status: issues.length === 0 ? 'ok' : 'issues_found',
    timestamp: new Date().toISOString(),
    batchCoverage: {
      lastProcessedBatch: metaResult.lastProcessedBatch,
      currentBatch,
      coveragePercent,
      ok: batchCoverageOk,
    },
    transactionCount: {
      dbCount,
      metaCount: metaResult.metaTotal,
      match: txCountMatch,
    },
    batchSpotCheck: {
      sampled: spotCheckDetails.length,
      passed: spotCheckPassed,
      failed: spotCheckFailed,
      details: spotCheckDetails,
    },
    blockRange: {
      min: blockRange.min,
      max: blockRange.max,
      currentBlock,
    },
    aggregateCheck: {
      sampled: aggregateDetails.length,
      passed: aggPassed,
      failed: aggFailed,
      details: aggregateDetails,
    },
    issues,
  }
}

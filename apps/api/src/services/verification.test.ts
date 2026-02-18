import { describe, test, expect, mock, beforeEach } from 'bun:test'

const mockRun = mock((_query: string, _params?: any) => {
  return Promise.resolve({ records: [] })
})

mock.module('../lib/neo4j', () => ({
  readTx: mock(async (work: (tx: any) => Promise<any>) => {
    return work({ run: mockRun })
  }),
  toNumber: (v: any) => (typeof v === 'number' ? v : Number(v || 0)),
}))

const mockGetBatchNumber = mock(() =>
  Promise.resolve({ data: 1000 })
)
const mockGetBlockNumber = mock(() =>
  Promise.resolve({ data: 50000 })
)
const mockGetTransactionsByBatchNumber = mock((_batch: number) =>
  Promise.resolve({ data: [] as any[] })
)

mock.module('./rpc-client', () => ({
  getRpcClient: () => ({
    blockchain: {
      getBatchNumber: mockGetBatchNumber,
      getBlockNumber: mockGetBlockNumber,
      getTransactionsByBatchNumber: mockGetTransactionsByBatchNumber,
    },
  }),
}))

import { verifyBackfillIntegrity } from './verification'

describe('verifyBackfillIntegrity', () => {
  beforeEach(() => {
    mockRun.mockReset()
    mockGetBatchNumber.mockReset()
    mockGetBlockNumber.mockReset()
    mockGetTransactionsByBatchNumber.mockReset()

    mockGetBatchNumber.mockImplementation(() =>
      Promise.resolve({ data: 1000 })
    )
    mockGetBlockNumber.mockImplementation(() =>
      Promise.resolve({ data: 50000 })
    )
    mockGetTransactionsByBatchNumber.mockImplementation(() =>
      Promise.resolve({ data: [] })
    )
  })

  test('returns ok when all checks pass', async () => {
    mockRun.mockImplementation((query: string) => {
      // Meta node query
      if (query.includes('Meta')) {
        return Promise.resolve({
          records: [{
            get: (key: string) => {
              if (key === 'batch') return 999
              if (key === 'total') return 5000
              return null
            },
          }],
        })
      }
      // Transaction count query
      if (query.includes('count(t)')) {
        return Promise.resolve({
          records: [{ get: () => 5000 }],
        })
      }
      // Block range query
      if (query.includes('min(t.blockNumber)')) {
        return Promise.resolve({
          records: [{
            get: (key: string) => {
              if (key === 'minBlock') return 1
              if (key === 'maxBlock') return 49900
              return null
            },
          }],
        })
      }
      // Aggregate check — return empty (no TRANSACTED_WITH edges sampled)
      if (query.includes('TRANSACTED_WITH')) {
        return Promise.resolve({ records: [] })
      }
      return Promise.resolve({ records: [] })
    })

    const result = await verifyBackfillIntegrity(0)

    expect(result.status).toBe('ok')
    expect(result.batchCoverage.ok).toBe(true)
    expect(result.batchCoverage.lastProcessedBatch).toBe(999)
    expect(result.batchCoverage.currentBatch).toBe(1000)
    expect(result.transactionCount.match).toBe(true)
    expect(result.transactionCount.dbCount).toBe(5000)
    expect(result.transactionCount.metaCount).toBe(5000)
    expect(result.issues).toEqual([])
  })

  test('detects batch coverage gap', async () => {
    mockRun.mockImplementation((query: string) => {
      if (query.includes('Meta')) {
        return Promise.resolve({
          records: [{
            get: (key: string) => {
              if (key === 'batch') return 500
              if (key === 'total') return 2000
              return null
            },
          }],
        })
      }
      if (query.includes('count(t)')) {
        return Promise.resolve({ records: [{ get: () => 2000 }] })
      }
      if (query.includes('min(t.blockNumber)')) {
        return Promise.resolve({
          records: [{
            get: (key: string) => {
              if (key === 'minBlock') return 1
              if (key === 'maxBlock') return 25000
              return null
            },
          }],
        })
      }
      if (query.includes('TRANSACTED_WITH')) {
        return Promise.resolve({ records: [] })
      }
      return Promise.resolve({ records: [] })
    })

    const result = await verifyBackfillIntegrity(0)

    expect(result.status).toBe('issues_found')
    expect(result.batchCoverage.ok).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues[0]).toContain('Batch coverage gap')
  })

  test('detects transaction count mismatch', async () => {
    mockRun.mockImplementation((query: string) => {
      if (query.includes('Meta')) {
        return Promise.resolve({
          records: [{
            get: (key: string) => {
              if (key === 'batch') return 999
              if (key === 'total') return 5000
              return null
            },
          }],
        })
      }
      if (query.includes('count(t)')) {
        return Promise.resolve({ records: [{ get: () => 4800 }] })
      }
      if (query.includes('min(t.blockNumber)')) {
        return Promise.resolve({
          records: [{
            get: (key: string) => {
              if (key === 'minBlock') return 1
              if (key === 'maxBlock') return 49900
              return null
            },
          }],
        })
      }
      if (query.includes('TRANSACTED_WITH')) {
        return Promise.resolve({ records: [] })
      }
      return Promise.resolve({ records: [] })
    })

    const result = await verifyBackfillIntegrity(0)

    expect(result.status).toBe('issues_found')
    expect(result.transactionCount.match).toBe(false)
    expect(result.transactionCount.dbCount).toBe(4800)
    expect(result.transactionCount.metaCount).toBe(5000)
    expect(result.issues).toContainEqual(expect.stringContaining('Transaction count mismatch'))
  })

  test('detects missing transactions in spot-check', async () => {
    mockGetTransactionsByBatchNumber.mockImplementation(() =>
      Promise.resolve({
        data: [
          { hash: 'tx-hash-1' },
          { hash: 'tx-hash-2' },
          { hash: 'tx-hash-3' },
        ],
      })
    )

    mockRun.mockImplementation((query: string) => {
      if (query.includes('Meta')) {
        return Promise.resolve({
          records: [{
            get: (key: string) => {
              if (key === 'batch') return 999
              if (key === 'total') return 5000
              return null
            },
          }],
        })
      }
      if (query.includes('count(t)')) {
        return Promise.resolve({ records: [{ get: () => 5000 }] })
      }
      // Spot-check: only tx-hash-1 found in DB
      if (query.includes('UNWIND')) {
        return Promise.resolve({
          records: [{ get: () => 'tx-hash-1' }],
        })
      }
      if (query.includes('min(t.blockNumber)')) {
        return Promise.resolve({
          records: [{
            get: (key: string) => {
              if (key === 'minBlock') return 1
              if (key === 'maxBlock') return 49900
              return null
            },
          }],
        })
      }
      if (query.includes('TRANSACTED_WITH')) {
        return Promise.resolve({ records: [] })
      }
      return Promise.resolve({ records: [] })
    })

    const result = await verifyBackfillIntegrity(3)

    expect(result.status).toBe('issues_found')
    expect(result.batchSpotCheck.failed).toBeGreaterThan(0)

    const failedDetail = result.batchSpotCheck.details.find((d) => !d.ok)
    expect(failedDetail).toBeDefined()
    expect(failedDetail!.rpcTxCount).toBe(3)
    expect(failedDetail!.dbMatchCount).toBe(1)
    expect(failedDetail!.missingHashes).toContain('tx-hash-2')
    expect(failedDetail!.missingHashes).toContain('tx-hash-3')
  })

  test('detects aggregate mismatch', async () => {
    mockRun.mockImplementation((query: string) => {
      if (query.includes('Meta')) {
        return Promise.resolve({
          records: [{
            get: (key: string) => {
              if (key === 'batch') return 999
              if (key === 'total') return 5000
              return null
            },
          }],
        })
      }
      if (query.includes('count(t) AS cnt')) {
        return Promise.resolve({ records: [{ get: () => 5000 }] })
      }
      if (query.includes('min(t.blockNumber)')) {
        return Promise.resolve({
          records: [{
            get: (key: string) => {
              if (key === 'minBlock') return 1
              if (key === 'maxBlock') return 49900
              return null
            },
          }],
        })
      }
      if (query.includes('TRANSACTED_WITH')) {
        return Promise.resolve({
          records: [{
            get: (key: string) => {
              if (key === 'fromId') return 'NQ42 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA'
              if (key === 'toId') return 'NQ42 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB'
              if (key === 'aggCount') return 10
              if (key === 'realCount') return 7
              return null
            },
          }],
        })
      }
      return Promise.resolve({ records: [] })
    })

    const result = await verifyBackfillIntegrity(0)

    expect(result.status).toBe('issues_found')
    expect(result.aggregateCheck.failed).toBe(1)
    expect(result.aggregateCheck.details[0].aggregateTxCount).toBe(10)
    expect(result.aggregateCheck.details[0].actualTxCount).toBe(7)
    expect(result.issues).toContainEqual(expect.stringContaining('Aggregate mismatch'))
  })

  test('handles empty Meta node gracefully', async () => {
    mockRun.mockImplementation((query: string) => {
      if (query.includes('Meta')) {
        return Promise.resolve({ records: [] })
      }
      if (query.includes('count(t)')) {
        return Promise.resolve({ records: [{ get: () => 0 }] })
      }
      if (query.includes('min(t.blockNumber)')) {
        return Promise.resolve({ records: [] })
      }
      if (query.includes('TRANSACTED_WITH')) {
        return Promise.resolve({ records: [] })
      }
      return Promise.resolve({ records: [] })
    })

    const result = await verifyBackfillIntegrity(0)

    expect(result.batchCoverage.lastProcessedBatch).toBe(-1)
    expect(result.status).toBe('issues_found')
  })
})

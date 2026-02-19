import { Database } from 'bun:sqlite'
import { mkdirSync } from 'fs'

export interface IndexerDb {
  markBatchIndexed(batch: number, txCount: number): void
  isBatchIndexed(batch: number): boolean
  getUnindexedBatches(from: number, to: number): number[]
  getLastIndexedBatch(): number
  getIndexedBatchCount(): number
  getTotalTransactionsIndexed(): number
  getMeta(key: string): string | null
  setMeta(key: string, value: string): void
  close(): void
}

export function openIndexerDb(path?: string): IndexerDb {
  const dbPath = path ?? process.env.INDEXER_DB_PATH ?? 'data/indexer.sqlite'

  // Ensure parent directory exists
  const dir = dbPath.substring(0, dbPath.lastIndexOf('/'))
  if (dir) {
    mkdirSync(dir, { recursive: true })
  }

  const db = new Database(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS indexed_batches (
      batch_number INTEGER PRIMARY KEY,
      tx_count INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS indexer_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  // Prepared statements for hot-path operations
  const stmtMark = db.prepare(
    'INSERT OR REPLACE INTO indexed_batches (batch_number, tx_count, indexed_at) VALUES (?, ?, ?)'
  )
  const stmtCheck = db.prepare(
    'SELECT 1 FROM indexed_batches WHERE batch_number = ?'
  )
  const stmtLastBatch = db.prepare(
    'SELECT MAX(batch_number) AS last FROM indexed_batches'
  )
  const stmtCount = db.prepare(
    'SELECT COUNT(*) AS cnt FROM indexed_batches'
  )
  const stmtTotalTx = db.prepare(
    'SELECT COALESCE(SUM(tx_count), 0) AS total FROM indexed_batches'
  )
  const stmtGetMeta = db.prepare(
    'SELECT value FROM indexer_meta WHERE key = ?'
  )
  const stmtSetMeta = db.prepare(
    'INSERT OR REPLACE INTO indexer_meta (key, value) VALUES (?, ?)'
  )
  const stmtIndexedInRange = db.prepare(
    'SELECT batch_number FROM indexed_batches WHERE batch_number >= ? AND batch_number <= ? ORDER BY batch_number'
  )

  return {
    markBatchIndexed(batch: number, txCount: number): void {
      stmtMark.run(batch, txCount, new Date().toISOString())
    },

    isBatchIndexed(batch: number): boolean {
      return stmtCheck.get(batch) != null
    },

    getUnindexedBatches(from: number, to: number): number[] {
      if (from > to) return []
      const rows = stmtIndexedInRange.all(from, to) as Array<{ batch_number: number }>
      const indexed = new Set(rows.map(r => r.batch_number))
      const gaps: number[] = []
      for (let i = from; i <= to; i++) {
        if (!indexed.has(i)) gaps.push(i)
      }
      return gaps
    },

    getLastIndexedBatch(): number {
      const row = stmtLastBatch.get() as { last: number | null } | null
      return row?.last ?? -1
    },

    getIndexedBatchCount(): number {
      const row = stmtCount.get() as { cnt: number }
      return row.cnt
    },

    getTotalTransactionsIndexed(): number {
      const row = stmtTotalTx.get() as { total: number }
      return row.total
    },

    getMeta(key: string): string | null {
      const row = stmtGetMeta.get(key) as { value: string } | null
      return row?.value ?? null
    },

    setMeta(key: string, value: string): void {
      stmtSetMeta.run(key, value)
    },

    close(): void {
      db.close()
    },
  }
}

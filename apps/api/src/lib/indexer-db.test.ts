import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openIndexerDb, type IndexerDb } from './indexer-db'

describe('indexer-db gap helpers', () => {
  let tempDir: string
  let db: IndexerDb

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'indexer-db-test-'))
    db = openIndexerDb(join(tempDir, 'indexer.sqlite'))

    db.markBatchIndexed(1, 1)
    db.markBatchIndexed(2, 1)
    db.markBatchIndexed(4, 1)
    db.markBatchIndexed(7, 1)
  })

  afterEach(() => {
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('returns efficient gap count and first gap in range', () => {
    expect(db.getGapCount(1, 7)).toBe(3) // 3,5,6
    expect(db.getFirstUnindexedBatch(1, 7)).toBe(3)
    expect(db.getFirstUnindexedBatch(1, 2)).toBeNull()
    expect(db.getFirstUnindexedBatch(8, 10)).toBe(8)
  })

  test('paginates unindexed batches with cursor', () => {
    expect(db.getUnindexedBatchesPage(1, 10, 2)).toEqual([3, 5])
    expect(db.getUnindexedBatchesPage(1, 10, 2, 5)).toEqual([6, 8])
    expect(db.getUnindexedBatchesPage(1, 10, 5, 8)).toEqual([9, 10])
  })
})

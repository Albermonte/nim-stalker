import { describe, expect, test } from 'bun:test'
import {
  estimateBackfillEtaMs,
  formatEta,
  isConsensusEstablishedResponse,
  parseBackfillTuning,
  parseGapRepairConfig,
  shouldPersistBackfillCheckpoint,
} from './blockchain-indexer'

describe('isConsensusEstablishedResponse', () => {
  test('treats wrapped JSON-RPC result.data=true as established', () => {
    expect(isConsensusEstablishedResponse({ result: { data: true } })).toBe(true)
  })

  test('treats legacy JSON-RPC result=true as established', () => {
    expect(isConsensusEstablishedResponse({ result: true })).toBe(true)
  })

  test('returns false for non-established and malformed payloads', () => {
    expect(isConsensusEstablishedResponse({ result: { data: false } })).toBe(false)
    expect(isConsensusEstablishedResponse({ result: false })).toBe(false)
    expect(isConsensusEstablishedResponse({ error: { code: -32601, message: 'Method not found' } })).toBe(false)
    expect(isConsensusEstablishedResponse({})).toBe(false)
  })
})

describe('parseBackfillTuning', () => {
  test('uses defaults when env variables are absent', () => {
    const tuning = parseBackfillTuning({})

    expect(tuning).toEqual({
      checkpointInterval: 100,
      throttleEveryBatches: 10,
      throttleMs: 0,
      deferAggregates: true,
    })
  })

  test('parses valid tuning values', () => {
    const tuning = parseBackfillTuning({
      BACKFILL_CHECKPOINT_INTERVAL: '250',
      BACKFILL_THROTTLE_EVERY_BATCHES: '5',
      BACKFILL_THROTTLE_MS: '20',
      BACKFILL_DEFER_AGGREGATES: 'false',
    })

    expect(tuning).toEqual({
      checkpointInterval: 250,
      throttleEveryBatches: 5,
      throttleMs: 20,
      deferAggregates: false,
    })
  })
})

describe('parseGapRepairConfig', () => {
  test('uses defaults when env variables are absent', () => {
    const config = parseGapRepairConfig({})

    expect(config).toEqual({
      intervalMs: 300_000,
      maxPerCycle: 50,
    })
  })

  test('parses valid values', () => {
    const config = parseGapRepairConfig({
      GAP_REPAIR_INTERVAL_MS: '60000',
      GAP_REPAIR_MAX_PER_CYCLE: '25',
    })

    expect(config).toEqual({
      intervalMs: 60_000,
      maxPerCycle: 25,
    })
  })

  test('falls back to defaults for invalid values', () => {
    const config = parseGapRepairConfig({
      GAP_REPAIR_INTERVAL_MS: '-1',
      GAP_REPAIR_MAX_PER_CYCLE: '0',
    })

    expect(config).toEqual({
      intervalMs: 300_000,
      maxPerCycle: 50,
    })
  })

  test('falls back to defaults for non-numeric values', () => {
    const config = parseGapRepairConfig({
      GAP_REPAIR_INTERVAL_MS: 'abc',
      GAP_REPAIR_MAX_PER_CYCLE: '',
    })

    expect(config).toEqual({
      intervalMs: 300_000,
      maxPerCycle: 50,
    })
  })
})

describe('shouldPersistBackfillCheckpoint', () => {
  test('persists every N processed batches', () => {
    expect(shouldPersistBackfillCheckpoint(100, 1, 1000, 100)).toBe(true)
    expect(shouldPersistBackfillCheckpoint(101, 1, 1000, 100)).toBe(false)
    expect(shouldPersistBackfillCheckpoint(200, 1, 1000, 100)).toBe(true)
  })

  test('always persists the final batch', () => {
    expect(shouldPersistBackfillCheckpoint(1000, 1, 1000, 100)).toBe(true)
  })

  test('persists every batch when interval is 1', () => {
    expect(shouldPersistBackfillCheckpoint(10, 1, 1000, 1)).toBe(true)
    expect(shouldPersistBackfillCheckpoint(11, 1, 1000, 1)).toBe(true)
  })
})

describe('estimateBackfillEtaMs', () => {
  test('estimates remaining time from elapsed time and processed batch count', () => {
    // 500 batches in 100 seconds = 0.2s/batch => 1000 remaining batches = 200s
    expect(estimateBackfillEtaMs(500, 1000, 100_000)).toBe(200_000)
  })

  test('returns null for invalid inputs', () => {
    expect(estimateBackfillEtaMs(0, 100, 10_000)).toBeNull()
    expect(estimateBackfillEtaMs(10, -1, 10_000)).toBeNull()
    expect(estimateBackfillEtaMs(10, 100, 0)).toBeNull()
  })
})

describe('formatEta', () => {
  test('formats minutes and seconds', () => {
    expect(formatEta(200_000)).toBe('3m 20s')
  })

  test('formats hours and minutes', () => {
    expect(formatEta(3_780_000)).toBe('1h 3m')
  })

  test('formats days and hours', () => {
    expect(formatEta(176_400_000)).toBe('2d 1h')
  })

  test('returns unknown when ETA cannot be estimated', () => {
    expect(formatEta(null)).toBe('unknown')
  })
})

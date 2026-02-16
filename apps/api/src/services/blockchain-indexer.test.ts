import { describe, expect, test } from 'bun:test'
import { isConsensusEstablishedResponse } from './blockchain-indexer'

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

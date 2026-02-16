import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';

mock.module('sonner', () => ({
  toast: {
    error: mock(() => {}),
    success: mock(() => {}),
  },
}));

const mockGetJobs = mock(() => Promise.resolve({
  jobs: [{
    address: 'NQ42 TIMEOUT TIMEOUT TIMEOUT TIMEOUT TIMEOUT TIMEOUT TIMEOUT TIMEOUT',
    status: 'INDEXING',
    startedAt: new Date().toISOString(),
    indexed: 0,
    incremental: false,
  }],
}));

class MockJobWebSocket {
  connected = false;
  constructor(_baseUrl: string, _handlers: unknown) {}
  dispose(): void {}
}

mock.module('@/lib/api', () => ({
  api: {
    getJobs: mockGetJobs,
  },
  JobWebSocket: MockJobWebSocket,
}));

import { _pollJobUntilDone } from './graph-store';

describe('job polling timeout', () => {
  beforeEach(() => {
    mockGetJobs.mockClear();
  });

  test('returns explicit timeout error job when job never completes', async () => {
    const result = await _pollJobUntilDone(
      'NQ42 TIMEOUT TIMEOUT TIMEOUT TIMEOUT TIMEOUT TIMEOUT TIMEOUT TIMEOUT',
      { timeoutMs: 50, pollIntervalMs: 10 }
    );

    expect(result).not.toBeNull();
    expect(result?.status).toBe('ERROR');
    expect(result?.error).toContain('Timed out waiting for indexing job');
  });

  afterAll(() => {
    // Prevent module mocks in this file from affecting other test files.
    mock.restore();
  });
});

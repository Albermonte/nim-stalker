import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ApiClient } from './api';

const originalFetch = global.fetch;

describe('ApiClient cache bounds', () => {
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      const id = decodeURIComponent(url.split('/address/')[1] || 'UNKNOWN');
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id,
          type: 'BASIC',
          balance: '0',
        }),
      });
    });
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('evicts old entries when cache exceeds max size', async () => {
    const api = new ApiClient('http://localhost:3001');

    for (let i = 0; i < 2105; i++) {
      await api.getAddress(`NQ${String(i).padStart(4, '0')} TEST TEST TEST TEST TEST TEST TEST TEST`);
    }

    expect((api as any).cache.size).toBeLessThanOrEqual(2000);
  });
});

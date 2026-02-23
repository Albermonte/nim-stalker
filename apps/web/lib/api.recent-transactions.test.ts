import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ApiClient } from './api';

const originalFetch = global.fetch;

describe('ApiClient getRecentTransactions', () => {
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [],
            total: 0,
            page: 1,
            pageSize: 50,
            hasMore: false,
          }),
      }),
    );
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('calls the recent transactions endpoint with pagination query', async () => {
    const api = new ApiClient('http://localhost:3001');
    await api.getRecentTransactions({ page: 1, pageSize: 50 });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/transactions/recent?page=1&pageSize=50',
      expect.any(Object),
    );
  });
});

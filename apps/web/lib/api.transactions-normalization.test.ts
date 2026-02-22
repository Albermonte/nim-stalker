import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ApiClient } from './api';

const originalFetch = global.fetch;

describe('ApiClient getTransactions address normalization', () => {
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
            pageSize: 100,
            hasMore: false,
          }),
      })
    );
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('strips spaces before building transactions endpoint path', async () => {
    const api = new ApiClient('http://localhost:3001');
    const formatted = 'NQ60 GH2T VEA2 CUR5 SXAD QU9B 7ELD YMG5 5T7U';

    await api.getTransactions(formatted, { page: 1, pageSize: 100, direction: 'both' });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/address/NQ60GH2TVEA2CUR5SXADQU9B7ELDYMG55T7U/transactions?page=1&pageSize=100&direction=both',
      expect.any(Object),
    );
  });
});

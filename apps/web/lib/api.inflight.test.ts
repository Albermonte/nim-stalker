import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ApiClient } from './api';

const originalFetch = global.fetch;

describe('ApiClient in-flight cleanup', () => {
  let mockFetch: ReturnType<typeof mock>;
  let unhandledRejections: unknown[] = [];

  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };

  beforeEach(() => {
    unhandledRejections = [];
    process.on('unhandledRejection', onUnhandledRejection);

    mockFetch = mock(() => Promise.reject(new TypeError('Failed to fetch')));
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandledRejection);
    global.fetch = originalFetch;
  });

  test('does not emit unhandled rejection when a GET request fails', async () => {
    const api = new ApiClient('http://localhost:3001');

    await expect(api.getLatestBlocksGraph(10)).rejects.toThrow('Failed to fetch');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unhandledRejections).toHaveLength(0);
  });
});

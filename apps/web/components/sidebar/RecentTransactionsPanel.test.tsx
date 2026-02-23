import React from 'react';
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { render, screen, waitFor } from '@/test/helpers/render';

const invalidateCacheMock = mock(() => {});
const getRecentTransactionsMock = mock(async () => ({
  data: [
    {
      hash: 'a'.repeat(64),
      from: 'NQ20 8P9L 3YMD GQYT 1TAA 8D0G MC12 5HBQ 1Q8A',
      to: 'NQ60 GH2T VEA2 CUR5 SXAD QU9B 7ELD YMG5 5T7U',
      value: '100000',
      fee: '1000',
      blockNumber: 42,
      timestamp: '2024-01-01T00:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
  hasMore: false,
}));

mock.module('@/lib/api', () => ({
  api: {
    invalidateCache: invalidateCacheMock,
    getRecentTransactions: getRecentTransactionsMock,
  },
}));

import { RecentTransactionsPanel } from './RecentTransactionsPanel';

describe('RecentTransactionsPanel', () => {
  beforeEach(() => {
    invalidateCacheMock.mockClear();
    getRecentTransactionsMock.mockClear();
  });

  test('refreshes only recent transactions feed', async () => {
    const view = render(<RecentTransactionsPanel />);

    await waitFor(() => expect(getRecentTransactionsMock).toHaveBeenCalledTimes(1));

    expect(getRecentTransactionsMock.mock.calls[0]?.[0]).toEqual({ page: 1, pageSize: 50 });
    expect(invalidateCacheMock).toHaveBeenCalledWith('/transactions/recent');
    expect(invalidateCacheMock).not.toHaveBeenCalledWith('/graph/latest');
    expect(screen.getByText(/Recent Transactions/i)).toBeInTheDocument();

    view.unmount();
  });
});

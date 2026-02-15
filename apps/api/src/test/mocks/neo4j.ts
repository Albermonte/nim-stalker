/**
 * Neo4j mock factory for testing
 * Creates mock Neo4j readTx/writeTx with configurable query results
 */

import { mock } from 'bun:test';

export interface MockRecord {
  get(key: string): unknown;
}

export interface MockResult {
  records: MockRecord[];
}

/**
 * Create a mock record from a key-value map
 */
export function createMockRecord(data: Record<string, unknown>): MockRecord {
  return {
    get(key: string) {
      return data[key];
    },
  };
}

/**
 * Create a mock result from records
 */
export function createMockResult(records: MockRecord[]): MockResult {
  return { records };
}

/**
 * Create mock readTx that returns configured results
 */
export function createMockReadTx() {
  return mock(async (work: (tx: any) => Promise<any>) => {
    return work(mockTxRunner);
  });
}

/**
 * Create mock writeTx that returns configured results
 */
export function createMockWriteTx() {
  return mock(async (work: (tx: any) => Promise<any>) => {
    return work(mockTxRunner);
  });
}

/**
 * Mock tx.run — configurable per-test via mockTxRun
 */
export const mockTxRun = mock((_query: string, _params?: Record<string, unknown>) =>
  Promise.resolve(createMockResult([]))
);

const mockTxRunner = {
  run: mockTxRun,
};

/**
 * Configure mockTxRun to return specific records for the next call
 */
export function mockTxRunReturns(records: Array<Record<string, unknown>>) {
  mockTxRun.mockImplementationOnce(() =>
    Promise.resolve(createMockResult(records.map(createMockRecord)))
  );
}

/**
 * Configure mockTxRun to return specific records for all calls
 */
export function mockTxRunAlwaysReturns(records: Array<Record<string, unknown>>) {
  mockTxRun.mockImplementation(() =>
    Promise.resolve(createMockResult(records.map(createMockRecord)))
  );
}

/**
 * Mock getDriver for health checks
 */
export const mockVerifyConnectivity = mock(() => Promise.resolve());

export function createMockDriver() {
  return {
    verifyConnectivity: mockVerifyConnectivity,
    close: mock(() => Promise.resolve()),
  };
}

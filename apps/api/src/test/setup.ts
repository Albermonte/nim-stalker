/**
 * Test setup for API tests
 * This file is preloaded before all tests
 */

import { beforeEach, afterEach, mock } from 'bun:test';

// Set test environment
process.env.NODE_ENV = 'test';
process.env.NEO4J_URI = 'bolt://localhost:7687';
process.env.NEO4J_USER = 'neo4j';
process.env.NEO4J_PASSWORD = 'test_password';
process.env.NIMIQ_RPC_URL = 'http://localhost:8648';
process.env.PORT = '3001';

// Reset all mocks between tests
beforeEach(() => {
  // Clear any module-level state that might persist between tests
});

afterEach(() => {
  // Clean up after each test
  mock.restore();
});

// Global test utilities
export function createMockRequest(
  url: string,
  options: RequestInit = {}
): Request {
  return new Request(`http://localhost:3001${url}`, options);
}

export function createMockHeaders(headers: Record<string, string> = {}): Headers {
  return new Headers(headers);
}

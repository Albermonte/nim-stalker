/**
 * Time mocking utilities for tests
 */

import { mock, beforeEach, afterEach } from 'bun:test';

let originalDateNow: () => number;
let mockedTime: number | null = null;

/**
 * Setup time mocking for a test suite
 * Call in describe block to enable time control
 */
export function setupTimeMocking() {
  beforeEach(() => {
    originalDateNow = Date.now;
    mockedTime = Date.now();
    Date.now = () => mockedTime!;
  });

  afterEach(() => {
    Date.now = originalDateNow;
    mockedTime = null;
  });
}

/**
 * Advance mocked time by specified milliseconds
 */
export function advanceTime(ms: number): void {
  if (mockedTime === null) {
    throw new Error('Time mocking not set up. Call setupTimeMocking() in describe block.');
  }
  mockedTime += ms;
}

/**
 * Set mocked time to specific timestamp
 */
export function setTime(timestamp: number): void {
  if (mockedTime === null) {
    throw new Error('Time mocking not set up. Call setupTimeMocking() in describe block.');
  }
  mockedTime = timestamp;
}

/**
 * Get current mocked time
 */
export function getCurrentTime(): number {
  if (mockedTime === null) {
    throw new Error('Time mocking not set up. Call setupTimeMocking() in describe block.');
  }
  return mockedTime;
}

/**
 * Create a mock date string for testing
 */
export function createMockDateString(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/**
 * Create timestamps for testing ranges
 */
export function createTimeRange(durationMs: number) {
  const start = Date.now();
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + durationMs).toISOString(),
  };
}

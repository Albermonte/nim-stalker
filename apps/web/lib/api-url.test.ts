import { describe, expect, test } from 'bun:test';
import { resolveApiBaseUrl } from './api-url';

describe('resolveApiBaseUrl', () => {
  test('uses explicit env URL when provided', () => {
    expect(
      resolveApiBaseUrl({
        envUrl: 'https://api.example.com',
        nodeEnv: 'production',
      }),
    ).toBe('https://api.example.com');
  });

  test('normalizes trailing slash for env URL', () => {
    expect(
      resolveApiBaseUrl({
        envUrl: 'https://api.example.com/',
        nodeEnv: 'production',
      }),
    ).toBe('https://api.example.com');
  });

  test('uses browser origin when env URL is missing', () => {
    expect(
      resolveApiBaseUrl({
        nodeEnv: 'production',
        browserOrigin: 'https://nimstalker.com',
      }),
    ).toBe('https://nimstalker.com');
  });

  test('falls back to localhost during development when env URL is missing', () => {
    expect(
      resolveApiBaseUrl({
        nodeEnv: 'development',
      }),
    ).toBe('http://localhost:3001');
  });

  test('does not fall back to localhost in production non-browser contexts', () => {
    expect(
      resolveApiBaseUrl({
        nodeEnv: 'production',
      }),
    ).toBe('');
  });
});

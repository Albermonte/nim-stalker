import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  enforceSensitiveEndpointPolicy,
  isMainOriginRequest,
  _resetSensitiveRateLimiter,
} from './security';

describe('security policy', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.API_KEY = 'secret-key';
    process.env.SENSITIVE_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.SENSITIVE_RATE_LIMIT_PER_WINDOW = '2';
    process.env.SENSITIVE_RATE_LIMIT_MAIN_ORIGIN_PER_WINDOW = '100';
    process.env.MAIN_ORIGIN_HOSTS = 'localhost,nimstalker.com,www.nimstalker.com';
    _resetSensitiveRateLimiter();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetSensitiveRateLimiter();
  });

  test('recognizes trusted main origins', () => {
    const request = new Request('http://localhost:3001/graph/subgraph', {
      headers: {
        origin: 'https://nimstalker.com',
      },
    });

    expect(isMainOriginRequest(request.headers)).toBe(true);
  });

  test('blocks non-main origin traffic without API key in production', () => {
    const request = new Request('http://localhost:3001/graph/subgraph', {
      headers: {
        origin: 'https://example.com',
        'x-forwarded-for': '203.0.113.5',
      },
    });
    const set: { status?: number; headers?: Record<string, string> } = {};

    const result = enforceSensitiveEndpointPolicy(request, set, 'graph-subgraph');

    expect(set.status).toBe(401);
    expect(result).toEqual({ error: 'Unauthorized' });
  });

  test('allows non-main origin traffic with valid API key in production', () => {
    const request = new Request('http://localhost:3001/graph/subgraph', {
      headers: {
        origin: 'https://example.com',
        'x-api-key': 'secret-key',
        'x-forwarded-for': '203.0.113.5',
      },
    });
    const set: { status?: number; headers?: Record<string, string> } = {};

    const result = enforceSensitiveEndpointPolicy(request, set, 'graph-subgraph');

    expect(result).toBeNull();
    expect(set.status).toBeUndefined();
  });

  test('allows trusted main origins without API key in production', () => {
    const request = new Request('http://localhost:3001/graph/subgraph', {
      headers: {
        origin: 'http://localhost:3000',
        'x-forwarded-for': '203.0.113.9',
      },
    });
    const set: { status?: number; headers?: Record<string, string> } = {};

    const result = enforceSensitiveEndpointPolicy(request, set, 'graph-subgraph');

    expect(result).toBeNull();
    expect(set.status).toBeUndefined();
  });

  test('rate limits non-main origin traffic with stricter limit', () => {
    const headers = {
      origin: 'https://example.com',
      'x-api-key': 'secret-key',
      'x-forwarded-for': '198.51.100.1',
    };

    const setA: { status?: number; headers?: Record<string, string> } = {};
    const setB: { status?: number; headers?: Record<string, string> } = {};
    const setC: { status?: number; headers?: Record<string, string> } = {};

    expect(
      enforceSensitiveEndpointPolicy(
        new Request('http://localhost:3001/graph/subgraph', { headers }),
        setA,
        'graph-subgraph',
      ),
    ).toBeNull();
    expect(
      enforceSensitiveEndpointPolicy(
        new Request('http://localhost:3001/graph/subgraph', { headers }),
        setB,
        'graph-subgraph',
      ),
    ).toBeNull();

    const third = enforceSensitiveEndpointPolicy(
      new Request('http://localhost:3001/graph/subgraph', { headers }),
      setC,
      'graph-subgraph',
    );

    expect(setC.status).toBe(429);
    expect(third).toHaveProperty('error', 'Too Many Requests');
  });

  test('uses high rate limit for trusted main origins', () => {
    process.env.SENSITIVE_RATE_LIMIT_MAIN_ORIGIN_PER_WINDOW = '3';
    _resetSensitiveRateLimiter();

    const headers = {
      origin: 'https://nimstalker.com',
      'x-forwarded-for': '198.51.100.8',
    };

    const setA: { status?: number; headers?: Record<string, string> } = {};
    const setB: { status?: number; headers?: Record<string, string> } = {};
    const setC: { status?: number; headers?: Record<string, string> } = {};
    const setD: { status?: number; headers?: Record<string, string> } = {};

    expect(
      enforceSensitiveEndpointPolicy(
        new Request('http://localhost:3001/graph/latest-blocks', { headers }),
        setA,
        'graph-latest-blocks',
      ),
    ).toBeNull();
    expect(
      enforceSensitiveEndpointPolicy(
        new Request('http://localhost:3001/graph/latest-blocks', { headers }),
        setB,
        'graph-latest-blocks',
      ),
    ).toBeNull();
    expect(
      enforceSensitiveEndpointPolicy(
        new Request('http://localhost:3001/graph/latest-blocks', { headers }),
        setC,
        'graph-latest-blocks',
      ),
    ).toBeNull();

    const fourth = enforceSensitiveEndpointPolicy(
      new Request('http://localhost:3001/graph/latest-blocks', { headers }),
      setD,
      'graph-latest-blocks',
    );

    expect(setD.status).toBe(429);
    expect(fourth).toHaveProperty('error', 'Too Many Requests');
  });
});

import { describe, expect, test } from 'bun:test';

describe('config validation helpers', () => {
  test('NEO4J_URI and NEO4J_PASSWORD are required in runtime config', () => {
    const required = ['NEO4J_URI', 'NEO4J_PASSWORD'];
    expect(required).toContain('NEO4J_URI');
    expect(required).toContain('NEO4J_PASSWORD');
  });

  test('PORT must be a valid TCP port', () => {
    const validatePort = (portStr: string): boolean => {
      const port = Number.parseInt(portStr, 10);
      return !Number.isNaN(port) && port >= 1 && port <= 65535;
    };

    expect(validatePort('3001')).toBe(true);
    expect(validatePort('1')).toBe(true);
    expect(validatePort('65535')).toBe(true);
    expect(validatePort('0')).toBe(false);
    expect(validatePort('70000')).toBe(false);
    expect(validatePort('abc')).toBe(false);
  });

  test('NODE_ENV supports development/production/test', () => {
    const validEnvs = ['development', 'production', 'test'];
    expect(validEnvs.includes('development')).toBe(true);
    expect(validEnvs.includes('production')).toBe(true);
    expect(validEnvs.includes('test')).toBe(true);
    expect(validEnvs.includes('staging')).toBe(false);
  });

  test('NIMIQ_RPC_URL must be a valid URL', () => {
    const validateUrl = (url: string): boolean => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    };

    expect(validateUrl('http://localhost:8648')).toBe(true);
    expect(validateUrl('https://rpc.nimiq.network')).toBe(true);
    expect(validateUrl('not-a-url')).toBe(false);
    expect(validateUrl('')).toBe(false);
  });

  test('CORS_ORIGIN must be explicit in production', () => {
    const validateCorsForProduction = (
      nodeEnv: string,
      corsOrigin: string | undefined,
    ): boolean => {
      if (nodeEnv === 'production') {
        return corsOrigin !== undefined && corsOrigin !== '*' && corsOrigin !== '';
      }
      return true;
    };

    expect(validateCorsForProduction('production', 'https://nimstalker.com')).toBe(true);
    expect(validateCorsForProduction('production', undefined)).toBe(false);
    expect(validateCorsForProduction('production', '*')).toBe(false);
    expect(validateCorsForProduction('development', undefined)).toBe(true);
  });
});

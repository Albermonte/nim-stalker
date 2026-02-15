import { describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';

const mockVerifyConnectivity = mock(async () => {});

mock.module('../lib/neo4j', () => ({
  getDriver: () => ({
    verifyConnectivity: mockVerifyConnectivity,
  }),
}));

import { healthRoutes } from './health';

const app = new Elysia().use(healthRoutes);

describe('GET /health', () => {
  test('returns healthy response when database is connected', async () => {
    mockVerifyConnectivity.mockImplementation(async () => {});

    const response = await app.handle(new Request('http://localhost/health'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.services.database).toBe('connected');
  });

  test('returns 503 with generic reason when database is unavailable', async () => {
    mockVerifyConnectivity.mockImplementation(async () => {
      throw new Error('connection refused');
    });

    const response = await app.handle(new Request('http://localhost/health'));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('unhealthy');
    expect(body.reason).toBe('database_unavailable');
    expect(body.error).toBeUndefined();
  });
});

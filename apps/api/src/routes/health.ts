import { Elysia } from 'elysia';
import { getDriver } from '../lib/neo4j';

export const healthRoutes = new Elysia({ prefix: '/health' })
  .get('/', async ({ set }) => {
    try {
      await getDriver().verifyConnectivity();

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'connected',
        },
      };
    } catch (error) {
      set.status = 503;
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'disconnected',
        },
        reason: 'database_unavailable',
      };
    }
  });

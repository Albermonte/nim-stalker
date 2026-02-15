import { Elysia } from 'elysia';
import { getDriver } from '../lib/neo4j';

export const healthRoutes = new Elysia({ prefix: '/health' })
  .get('/', async () => {
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
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'disconnected',
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

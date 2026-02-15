import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { config } from './lib/config';
import { ensureConstraints, closeDriver } from './lib/neo4j';
import { getAddressLabelService } from './lib/address-labels';
import { healthRoutes } from './routes/health';
import { addressRoutes } from './routes/address';
import { graphRoutes } from './routes/graph';
import { jobsRoutes } from './routes/jobs';
import { transactionRoutes } from './routes/transaction';
import { indexerRoutes } from './routes/indexer';
import { startBlockchainIndexer } from './services/blockchain-indexer';


// Initialize Neo4j constraints before starting the server
await ensureConstraints();

// Initialize address label service (validators API + address book)
await getAddressLabelService().initialize({ startupTimeoutMs: 3000, refreshTimeoutMs: 5000 });

// Start blockchain indexer (backfill + live subscription)
const indexer = startBlockchainIndexer();

const isProduction = config.nodeEnv === 'production';

const app = new Elysia()
  .use(cors({
    origin: config.corsOrigin || (isProduction ? false : '*'),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86400, // Cache preflight responses for 24h
  }))
  .use(healthRoutes)
  .use(addressRoutes)
  .use(graphRoutes)
  .use(jobsRoutes)
  .use(transactionRoutes)
  .use(indexerRoutes)
  .get('/', () => ({
    name: 'NIM Stalker API',
    version: '0.0.1',
  }))
  .listen(config.port);

console.log(`🚀 NIM Stalker API running at ${app.server?.hostname}:${app.server?.port}`);

// Graceful shutdown
const shutdown = async () => {
  console.log('\nShutting down...');
  await indexer.stop();
  await closeDriver();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export type App = typeof app;

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
await getAddressLabelService().initialize();

// Start blockchain indexer (backfill + live subscription)
const indexer = startBlockchainIndexer();

const isProduction = config.nodeEnv === 'production';

const app = new Elysia()
  .use(cors({
    origin: config.corsOrigin || (isProduction ? false : '*'),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86400, // Cache preflight responses for 24h
  }))
  // Gzip compression for JSON responses (70-85% bandwidth reduction on graph data)
  .mapResponse(({ response, set, request }) => {
    const acceptEncoding = request.headers.get('accept-encoding') ?? '';
    if (
      !acceptEncoding.includes('gzip') ||
      response === null ||
      response === undefined
    ) {
      return response;
    }

    // Only compress JSON-like responses above a threshold
    const body = typeof response === 'object'
      ? JSON.stringify(response)
      : typeof response === 'string'
        ? response
        : null;

    if (!body || body.length < 1024) return response;

    const compressed = Bun.gzipSync(Buffer.from(body));
    set.headers['content-encoding'] = 'gzip';
    set.headers['content-type'] = 'application/json; charset=utf-8';
    return new Response(compressed, { headers: set.headers as HeadersInit });
  })
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

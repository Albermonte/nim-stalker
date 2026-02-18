import neo4j, { type Driver, type ManagedTransaction, type Integer, type DateTime, type QueryResult } from 'neo4j-driver';
import { config } from './config';

let driver: Driver | undefined;

/**
 * Get or create the Neo4j driver singleton
 */
export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      config.neo4jUri,
      neo4j.auth.basic(config.neo4jUser, config.neo4jPassword),
      {
        maxConnectionPoolSize: 10,
        connectionAcquisitionTimeout: 30_000,
        logging: {
          level: config.nodeEnv === 'development' ? 'warn' : 'error',
          logger: (level, message) => console[level as 'warn' | 'error'](`[neo4j] ${message}`),
        },
      }
    );
  }
  return driver;
}

/**
 * Execute a read transaction
 */
export async function readTx<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
  const session = getDriver().session();
  try {
    return await session.executeRead(work);
  } finally {
    await session.close();
  }
}

/**
 * Execute a write transaction
 */
export async function writeTx<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
  const session = getDriver().session();
  try {
    return await session.executeWrite(work);
  } finally {
    await session.close();
  }
}

/**
 * Execute a query in auto-commit (implicit) transaction mode.
 * Required for queries using CALL {} IN TRANSACTIONS (batched writes),
 * which cannot run inside executeRead/executeWrite managed transactions.
 */
export async function runAutoCommit(query: string, params?: Record<string, unknown>): Promise<QueryResult> {
  const session = getDriver().session();
  try {
    return await session.run(query, params);
  } finally {
    await session.close();
  }
}

// --- Conversion utilities ---

/**
 * Convert Neo4j Integer to JS number
 */
export function toNumber(value: Integer | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  return neo4j.integer.toNumber(value);
}

/**
 * Convert Neo4j Integer to BigInt string (for large values like Luna amounts)
 */
export function toBigIntString(value: Integer | number | bigint | string | null | undefined): string {
  if (value == null) return '0';
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return value.toString();
  return value.toBigInt().toString();
}

/**
 * Convert Neo4j DateTime or ISO string to JS Date
 */
export function toDate(value: DateTime | string | null | undefined): Date | null {
  if (value == null) return null;
  if (typeof value === 'string') return new Date(value);
  // Neo4j DateTime object
  return new Date(value.toString());
}

/**
 * Convert Neo4j DateTime or ISO string to ISO string
 */
export function toISOString(value: DateTime | string | null | undefined): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

/**
 * Create constraints and indexes idempotently at startup
 */
export async function ensureConstraints(): Promise<void> {
  const session = getDriver().session();
  try {
    const statements = [
      // Unique constraints
      'CREATE CONSTRAINT address_id IF NOT EXISTS FOR (a:Address) REQUIRE a.id IS UNIQUE',
      'CREATE CONSTRAINT transaction_hash IF NOT EXISTS FOR ()-[t:TRANSACTION]-() REQUIRE t.hash IS UNIQUE',
      // Indexes for common lookups
      'CREATE INDEX address_index_status IF NOT EXISTS FOR (a:Address) ON (a.indexStatus)',
      'CREATE INDEX transaction_timestamp IF NOT EXISTS FOR ()-[t:TRANSACTION]-() ON (t.timestamp)',
      'CREATE INDEX transaction_block IF NOT EXISTS FOR ()-[t:TRANSACTION]-() ON (t.blockNumber)',
      'CREATE INDEX transacted_with_tx_count IF NOT EXISTS FOR ()-[r:TRANSACTED_WITH]-() ON (r.txCount)',
      // Composite index for TRANSACTED_WITH timestamp filtering (used in graph expand)
      'CREATE INDEX transacted_with_timestamps IF NOT EXISTS FOR ()-[r:TRANSACTED_WITH]-() ON (r.lastTxAt, r.firstTxAt)',
      // TRANSACTED_WITH totalValue index (used in graph expand with value filters)
      'CREATE INDEX transacted_with_total_value IF NOT EXISTS FOR ()-[r:TRANSACTED_WITH]-() ON (r.totalValue)',
      // TRANSACTION value index (used in address transaction listing with value filters)
      'CREATE INDEX transaction_value IF NOT EXISTS FOR ()-[t:TRANSACTION]-() ON (t.value)',
      // Composite index: Address id + indexStatus (used for pending lookups during indexing)
      'CREATE INDEX address_id_status IF NOT EXISTS FOR (a:Address) ON (a.id, a.indexStatus)',
      // Meta node for indexer state (lastProcessedBatch, etc.)
      'CREATE CONSTRAINT meta_key_unique IF NOT EXISTS FOR (m:Meta) REQUIRE m.key IS UNIQUE',
    ];

    for (const stmt of statements) {
      await session.run(stmt);
    }
    console.log('  Neo4j constraints and indexes ensured');
  } finally {
    await session.close();
  }
}

/**
 * Graceful shutdown — close the driver
 */
export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = undefined;
    console.log('  Neo4j driver closed');
  }
}

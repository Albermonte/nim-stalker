import { ensureRpcClient, getRpcClient, mapTransaction } from './rpc-client'
import { formatAddress } from '../lib/address-utils'

export interface TransactionData {
  hash: string;
  blockNumber: number;
  timestamp: number;
  confirmations: number;
  size: number;
  relatedAddresses: string[];
  from: string;
  fromType: number;
  to: string;
  toType: number;
  value: number;
  fee: number;
  senderData: string;
  recipientData: string;
  flags: number;
  validityStartHeight: number;
  proof: string;
  networkId: number;
  executionResult: boolean;
}

interface BlockData {
  hash: string;
  number: number;
  timestamp: number;
  transactions: TransactionData[];
}

/**
 * Unwrap a CallResult, throwing on error.
 */
function unwrap<T>(result: { data?: T; error?: { code: number; message: string } }): T {
  const { data, error } = result
  if (error) {
    throw new Error(error.message ?? 'RPC call failed')
  }
  return data as T
}

export class NimiqService {
  constructor() {
    ensureRpcClient()
  }

  async getAccount(address: string) {
    const client = getRpcClient()
    const result = await client.blockchain.getAccountByAddress(address, { withMetadata: false })
    const account = unwrap(result)

    return {
      address: account?.address ?? address,
      balance: account?.balance ?? 0,
      type: account?.type?.toUpperCase() ?? 'UNKNOWN',
    }
  }

  async getTransactionsByAddress(address: string, max: number = 500, startAt: string | null = null): Promise<TransactionData[]> {
    const client = getRpcClient()
    const result = await client.blockchain.getTransactionsByAddress(address, {
      max,
      ...(startAt ? { startAt } : {}),
    } as any)
    const txs = unwrap(result)
    return (txs || []).map(mapTransaction)
  }

  async getTransactionByHash(hash: string): Promise<TransactionData> {
    const client = getRpcClient()
    const result = await client.blockchain.getTransactionByHash(hash)
    return mapTransaction(unwrap(result))
  }

  async getBlockNumber(): Promise<number> {
    const client = getRpcClient()
    const result = await client.blockchain.getBlockNumber()
    return unwrap(result)
  }

  async getBlockByNumber(blockNumber: number, includeTransactions: boolean = true): Promise<BlockData> {
    const client = getRpcClient()
    const result = await client.blockchain.getBlockByNumber(blockNumber, { includeBody: includeTransactions })
    const block = unwrap(result)

    return {
      hash: block.hash,
      number: block.number,
      timestamp: block.timestamp,
      transactions: (block.transactions || []).map(mapTransaction),
    }
  }

  /**
   * Fetch all transactions for an address using cursor-based pagination.
   * Calls onBatch every `batchFlushInterval` RPC fetches to allow streaming writes.
   * Returns total transaction count.
   */
  async getAllTransactions(
    address: string,
    onBatch: (txs: TransactionData[]) => Promise<void>,
    batchFlushInterval = 20
  ): Promise<number> {
    const rpcBatchSize = 500;
    let buffer: TransactionData[] = [];
    let startAt: string | null = null;
    let batchNum = 0;
    let totalCount = 0;

    while (true) {
      batchNum++;
      const batch = await this.getTransactionsByAddress(address, rpcBatchSize, startAt);
      console.log(`[NimiqRPC] getAllTransactions batch ${batchNum}: ${batch.length} txs`);

      if (batch.length === 0) break;

      buffer.push(...batch);
      totalCount += batch.length;

      if (batchNum % batchFlushInterval === 0) {
        await onBatch(buffer);
        buffer = [];
      }

      if (batch.length < rpcBatchSize) break;

      startAt = batch[batch.length - 1].hash;
    }

    if (buffer.length > 0) {
      await onBatch(buffer);
    }

    console.log(`[NimiqRPC] getAllTransactions complete: ${totalCount} total txs in ${batchNum} batches`);
    return totalCount;
  }

  /**
   * Fetch remaining (older) transactions starting from a given hash,
   * skipping already-known hashes. Used to recover gaps from interrupted indexing.
   */
  async getRemainingTransactions(
    address: string,
    startAtHash: string,
    knownHashes: Set<string>,
    onBatch: (txs: TransactionData[]) => Promise<void>,
    batchFlushInterval = 20
  ): Promise<number> {
    const rpcBatchSize = 500;
    let buffer: TransactionData[] = [];
    let startAt: string | null = startAtHash;
    let batchNum = 0;
    let totalCount = 0;

    while (true) {
      batchNum++;
      const batch = await this.getTransactionsByAddress(address, rpcBatchSize, startAt);
      console.log(`[NimiqRPC] getRemainingTransactions batch ${batchNum}: ${batch.length} txs`);

      if (batch.length === 0) break;

      for (const tx of batch) {
        if (!knownHashes.has(tx.hash)) {
          buffer.push(tx);
          totalCount++;
        }
      }

      if (batchNum % batchFlushInterval === 0 && buffer.length > 0) {
        await onBatch(buffer);
        buffer = [];
      }

      if (batch.length < rpcBatchSize) break;

      startAt = batch[batch.length - 1].hash;
    }

    if (buffer.length > 0) {
      await onBatch(buffer);
    }

    console.log(`[NimiqRPC] getRemainingTransactions complete: ${totalCount} recovered txs in ${batchNum} batches`);
    return totalCount;
  }

  /**
   * Fetch only new transactions not already known.
   * Fetches 100 at a time, stops when a batch contains a known hash.
   */
  async getNewTransactions(
    address: string,
    knownHashes: Set<string>,
    onBatch: (txs: TransactionData[]) => Promise<void>,
    batchFlushInterval = 20
  ): Promise<number> {
    const rpcBatchSize = 100;
    let buffer: TransactionData[] = [];
    let startAt: string | null = null;
    let batchNum = 0;
    let totalCount = 0;

    while (true) {
      batchNum++;
      const batch = await this.getTransactionsByAddress(address, rpcBatchSize, startAt);
      console.log(`[NimiqRPC] getNewTransactions batch ${batchNum}: ${batch.length} txs`);

      if (batch.length === 0) break;

      let foundKnown = false;
      for (const tx of batch) {
        if (knownHashes.has(tx.hash)) {
          foundKnown = true;
          break;
        }
        buffer.push(tx);
        totalCount++;
      }

      if (batchNum % batchFlushInterval === 0 && buffer.length > 0) {
        await onBatch(buffer);
        buffer = [];
      }

      if (foundKnown) break;

      if (batch.length < rpcBatchSize) break;

      startAt = batch[batch.length - 1].hash;
    }

    if (buffer.length > 0) {
      await onBatch(buffer);
    }

    console.log(`[NimiqRPC] getNewTransactions complete: ${totalCount} new txs in ${batchNum} batches`);
    return totalCount;
  }

  /**
   * Like getNewTransactions but checks hash existence via a DB callback instead of an in-memory Set.
   */
  async getNewTransactionsWithDbCheck(
    address: string,
    checkExists: (hashes: string[]) => Promise<Set<string>>,
    onBatch: (txs: TransactionData[]) => Promise<void>,
    batchFlushInterval = 20
  ): Promise<number> {
    const rpcBatchSize = 100;
    let buffer: TransactionData[] = [];
    let startAt: string | null = null;
    let batchNum = 0;
    let totalCount = 0;

    while (true) {
      batchNum++;
      const batch = await this.getTransactionsByAddress(address, rpcBatchSize, startAt);
      console.log(`[NimiqRPC] getNewTransactionsWithDbCheck batch ${batchNum}: ${batch.length} txs`);

      if (batch.length === 0) break;

      const batchHashes = batch.map((tx) => tx.hash);
      const existingHashes = await checkExists(batchHashes);

      let foundKnown = false;
      for (const tx of batch) {
        if (existingHashes.has(tx.hash)) {
          foundKnown = true;
          break;
        }
        buffer.push(tx);
        totalCount++;
      }

      if (batchNum % batchFlushInterval === 0 && buffer.length > 0) {
        await onBatch(buffer);
        buffer = [];
      }

      if (foundKnown) break;
      if (batch.length < rpcBatchSize) break;

      startAt = batch[batch.length - 1].hash;
    }

    if (buffer.length > 0) {
      await onBatch(buffer);
    }

    console.log(`[NimiqRPC] getNewTransactionsWithDbCheck complete: ${totalCount} new txs in ${batchNum} batches`);
    return totalCount;
  }

  /**
   * Like getRemainingTransactions but checks hash existence via a DB callback.
   */
  async getRemainingTransactionsWithDbCheck(
    address: string,
    startAtHash: string,
    checkExists: (hashes: string[]) => Promise<Set<string>>,
    onBatch: (txs: TransactionData[]) => Promise<void>,
    batchFlushInterval = 20
  ): Promise<number> {
    const rpcBatchSize = 500;
    let buffer: TransactionData[] = [];
    let startAt: string | null = startAtHash;
    let batchNum = 0;
    let totalCount = 0;

    while (true) {
      batchNum++;
      const batch = await this.getTransactionsByAddress(address, rpcBatchSize, startAt);
      console.log(`[NimiqRPC] getRemainingTransactionsWithDbCheck batch ${batchNum}: ${batch.length} txs`);

      if (batch.length === 0) break;

      const batchHashes = batch.map((tx) => tx.hash);
      const existingHashes = await checkExists(batchHashes);

      for (const tx of batch) {
        if (!existingHashes.has(tx.hash)) {
          buffer.push(tx);
          totalCount++;
        }
      }

      if (batchNum % batchFlushInterval === 0 && buffer.length > 0) {
        await onBatch(buffer);
        buffer = [];
      }

      if (batch.length < rpcBatchSize) break;

      startAt = batch[batch.length - 1].hash;
    }

    if (buffer.length > 0) {
      await onBatch(buffer);
    }

    console.log(`[NimiqRPC] getRemainingTransactionsWithDbCheck complete: ${totalCount} recovered txs in ${batchNum} batches`);
    return totalCount;
  }
}

// Singleton instance
let nimiqService: NimiqService | null = null;

export function getNimiqService(): NimiqService {
  if (!nimiqService) {
    nimiqService = new NimiqService();
  }
  return nimiqService;
}

import { createClient, type NimiqRPCClient, type Transaction as RpcTransaction } from '@albermonte/nimiq-rpc-client-ts'
import { config } from '../lib/config'
import { formatAddress } from '../lib/address-utils'
import type { TransactionData } from './nimiq-rpc'

let client: NimiqRPCClient | null = null

/**
 * Initialize the @albermonte/nimiq-rpc-client-ts singleton.
 * Safe to call multiple times — only the first call takes effect.
 */
export function ensureRpcClient(): void {
  if (client) return
  client = createClient(config.nimiqRpcUrl)
}

/**
 * Get the initialized RPC client instance.
 * Throws if ensureRpcClient() hasn't been called.
 */
export function getRpcClient(): NimiqRPCClient {
  if (!client) {
    ensureRpcClient()
  }
  return client!
}

/**
 * Convert a library Transaction to our internal TransactionData format.
 * Handles bigint timestamp → ms number, address formatting, etc.
 */
export function mapTransaction(tx: RpcTransaction): TransactionData {
  return {
    hash: tx.hash,
    blockNumber: tx.blockNumber ?? 0,
    // Library returns timestamp as bigint (milliseconds since epoch)
    timestamp: tx.timestamp ? Number(tx.timestamp) : 0,
    confirmations: tx.confirmations ?? 0,
    size: tx.size,
    relatedAddresses: Array.isArray(tx.relatedAddresses)
      ? Array.from(tx.relatedAddresses)
      : Array.from(tx.relatedAddresses ?? []),
    from: formatAddress(tx.from),
    fromType: tx.fromType,
    to: formatAddress(tx.to),
    toType: tx.toType,
    value: tx.value,
    fee: tx.fee,
    senderData: tx.senderData ?? '',
    recipientData: tx.recipientData ?? '',
    flags: tx.flags,
    validityStartHeight: tx.validityStartHeight,
    proof: tx.proof ?? '',
    networkId: tx.networkId,
    executionResult: true,
  }
}

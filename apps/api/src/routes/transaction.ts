import { Elysia, t } from 'elysia';
import { readTx, toNumber, toBigIntString, toISOString } from '../lib/neo4j';
import { getNimiqService } from '../services/nimiq-rpc';
import { formatAddress } from '../lib/address-utils';

export const transactionRoutes = new Elysia()
  .get(
    '/transaction/:hash',
    async ({ params, set }) => {
      const { hash } = params;

      // Validate hash format (64 hex characters)
      if (!/^[a-fA-F0-9]{64}$/.test(hash)) {
        set.status = 400;
        return { error: 'Invalid transaction hash format. Expected 64 hex characters.' };
      }

      try {
        // Try Neo4j first
        const dbResult = await readTx(async (tx) => {
          const res = await tx.run(
            `MATCH (from:Address)-[t:TRANSACTION {hash: $hash}]->(to:Address)
             RETURN from.id AS fromAddr, to.id AS toAddr,
                    t.hash AS hash, t.value AS value, t.fee AS fee,
                    t.blockNumber AS blockNumber, t.timestamp AS timestamp, t.data AS data`,
            { hash },
          );

          if (res.records.length === 0) return null;

          const record = res.records[0];
          return {
            hash: record.get('hash'),
            from: record.get('fromAddr'),
            to: record.get('toAddr'),
            value: toBigIntString(record.get('value')),
            fee: toBigIntString(record.get('fee')),
            blockNumber: toNumber(record.get('blockNumber')),
            timestamp: toISOString(record.get('timestamp')),
            data: record.get('data') ?? null,
          };
        });

        if (dbResult) {
          return dbResult;
        }

        // Not in DB — fetch from RPC node
        const rpc = getNimiqService();
        const rpcTx = await rpc.getTransactionByHash(hash);

        if (!rpcTx) {
          set.status = 404;
          return { error: 'Transaction not found.' };
        }

        return {
          hash: rpcTx.hash,
          from: formatAddress(rpcTx.from),
          to: formatAddress(rpcTx.to),
          value: String(rpcTx.value),
          fee: String(rpcTx.fee),
          blockNumber: rpcTx.blockNumber,
          timestamp: rpcTx.timestamp ? new Date(rpcTx.timestamp * 1000).toISOString() : null,
          data: rpcTx.senderData || rpcTx.recipientData || null,
        };
      } catch (err) {
        set.status = 500;
        return { error: err instanceof Error ? err.message : 'Failed to fetch transaction' };
      }
    },
    {
      params: t.Object({
        hash: t.String(),
      }),
    },
  );

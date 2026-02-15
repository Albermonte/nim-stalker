import { readTx, toNumber } from '../lib/neo4j';

/**
 * Batch count transactions for multiple addresses using a single Cypher query (avoids N+1)
 * Counts both incoming and outgoing transactions per address
 */
export async function batchCountTransactions(nodeIds: string[]): Promise<Map<string, number>> {
  if (nodeIds.length === 0) {
    return new Map();
  }

  return readTx(async (tx) => {
    const result = await tx.run(
      `UNWIND $nodeIds AS nid
       MATCH (a:Address {id: nid})
       OPTIONAL MATCH (a)-[t:TRANSACTION]-()
       RETURN a.id AS id, count(t) AS txCount`,
      { nodeIds }
    );

    const txCountMap = new Map<string, number>();
    // Initialize all requested IDs with 0
    for (const id of nodeIds) {
      txCountMap.set(id, 0);
    }
    for (const record of result.records) {
      const id = record.get('id') as string;
      txCountMap.set(id, toNumber(record.get('txCount')));
    }
    return txCountMap;
  });
}

import { Elysia, t } from 'elysia'
import { getIndexerStatusWithProgress, getIndexerDb } from '../services/blockchain-indexer'
import { verifyBackfillIntegrity } from '../services/verification'
import { enforceSensitiveEndpointPolicy } from '../lib/security'

export const indexerRoutes = new Elysia({ prefix: '/indexer' })
  .get('/status', async () => {
    return await getIndexerStatusWithProgress()
  })
  .get('/verify', async ({ query, request, set }) => {
    const rateLimitError = enforceSensitiveEndpointPolicy(request, set, 'indexer-verify')
    if (rateLimitError) return rateLimitError

    const sampleSize = Math.min(Math.max(Number(query.sample) || 10, 1), 50)
    const includeGapList = String(query.includeGapList ?? '').toLowerCase() === 'true'

    try {
      return await verifyBackfillIntegrity(
        sampleSize,
        getIndexerDb() ?? undefined,
        { includeGapList }
      )
    } catch (error) {
      set.status = 500
      return { error: error instanceof Error ? error.message : 'Verification failed' }
    }
  }, {
    query: t.Object({
      sample: t.Optional(t.String()),
      includeGapList: t.Optional(t.String()),
    }),
  })

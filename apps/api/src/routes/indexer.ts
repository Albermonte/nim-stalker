import { Elysia } from 'elysia'
import { getIndexerStatusWithProgress } from '../services/blockchain-indexer'

export const indexerRoutes = new Elysia({ prefix: '/indexer' })
  .get('/status', async () => {
    return await getIndexerStatusWithProgress()
  })

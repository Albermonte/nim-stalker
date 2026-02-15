import { Elysia } from 'elysia';
import { jobTracker } from '../lib/job-tracker';

const unsubscribers = new Map<unknown, () => void>();

export const jobsRoutes = new Elysia()
  .get('/jobs', () => {
    return { jobs: jobTracker.getJobs() };
  })
  .ws('/jobs/ws', {
    open(ws) {
      ws.send(JSON.stringify({ type: 'snapshot', jobs: jobTracker.getJobs() }));
      const unsubscribe = jobTracker.subscribe((job) => {
        ws.send(JSON.stringify({ type: 'job-update', job }));
      });
      unsubscribers.set(ws, unsubscribe);
    },
    close(ws) {
      const unsubscribe = unsubscribers.get(ws);
      if (unsubscribe) {
        unsubscribe();
        unsubscribers.delete(ws);
      }
    },
    message(_ws, _message) {
      // No client messages expected
    },
  });

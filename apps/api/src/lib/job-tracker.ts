import type { IndexingJob } from '@nim-stalker/shared';

const jobs = new Map<string, IndexingJob>();
const cleanupTimers = new Map<string, Timer>();

const listeners = new Set<(job: IndexingJob) => void>();

const AUTO_REMOVE_MS = 60_000;

export const jobTracker = {
  startJob(address: string, incremental: boolean): void {
    // Clear any pending cleanup timer for this address
    const timer = cleanupTimers.get(address);
    if (timer) {
      clearTimeout(timer);
      cleanupTimers.delete(address);
    }

    jobs.set(address, {
      address,
      status: 'INDEXING',
      startedAt: new Date().toISOString(),
      indexed: 0,
      incremental,
    });
    this.notify(jobs.get(address)!);
  },

  updateProgress(address: string, count: number): void {
    const job = jobs.get(address);
    if (job) {
      job.indexed += count;
      this.notify(job);
    }
  },

  completeJob(address: string, totalIndexed: number): void {
    const job = jobs.get(address);
    if (job) {
      job.status = 'COMPLETE';
      job.indexed = totalIndexed;
      job.completedAt = new Date().toISOString();
      this.notify(job);
      this.scheduleRemoval(address);
    }
  },

  failJob(address: string, error: string): void {
    const job = jobs.get(address);
    if (job) {
      job.status = 'ERROR';
      job.error = error;
      job.completedAt = new Date().toISOString();
      this.notify(job);
      this.scheduleRemoval(address);
    }
  },

  getJobs(): IndexingJob[] {
    return Array.from(jobs.values());
  },

  hasJob(address: string): boolean {
    const job = jobs.get(address);
    return !!job && job.status === 'INDEXING';
  },

  subscribe(fn: (job: IndexingJob) => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  notify(job: IndexingJob): void {
    for (const fn of listeners) {
      fn(job);
    }
  },

  scheduleRemoval(address: string): void {
    const timer = setTimeout(() => {
      jobs.delete(address);
      cleanupTimers.delete(address);
    }, AUTO_REMOVE_MS);
    cleanupTimers.set(address, timer);
  },
};

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: Timer
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Simple concurrency pool for limiting parallel async operations.
 * Processes tasks with a configurable concurrency limit.
 */
export async function poolAll<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => runWorker()
  );

  await Promise.all(workers);
  return results;
}

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

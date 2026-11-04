const HOUR_MS = 60 * 60 * 1000;

/**
 * True when one more row would go over `max` per hour. Pass the caller's
 * `max` newest rows, newest first (an index ordered by creation, `.take(max)`):
 * the limit is reached if all of them were created within the last hour.
 */
export function hourlyLimitReached(newestFirst: Array<{ _creationTime: number }>, max: number): boolean {
  const hourAgo = Date.now() - HOUR_MS;
  return newestFirst.length >= max && newestFirst.every((row) => row._creationTime > hourAgo);
}

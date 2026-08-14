/**
 * Run async work with an explicit concurrency ceiling.
 * Import confirm and Delivery DO generation must not unbounded-Promise.all.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  const results = new Array<R>(n);
  if (n === 0) return results;
  const cap = Math.max(1, Math.min(limit, n));
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next;
      next += 1;
      if (i >= n) return;
      results[i] = await mapper(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: cap }, () => worker()));
  return results;
}

/** Independent trip Delivery DO PDF/uploads on canonical create. */
export const CANONICAL_JOB_DELIVERY_DO_CONCURRENCY = 2;

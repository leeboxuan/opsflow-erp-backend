/**
 * Apply a filter from a map to the Prisma `where` object.
 * - If filter is undefined/null/"" or "all" -> no change.
 * - If map[filter] is missing -> no change (warn in non-prod).
 * - Else Object.assign(where, map[filter]).
 */
export function applyMappedFilter<
  TWhere extends Record<string, any>,
  TFilter extends string
>(
  where: TWhere,
  filter: TFilter | undefined,
  map: Partial<Record<TFilter, Partial<TWhere>>>
): void {
  if (filter === undefined || filter === null || filter === "") return;
  if (filter === "all") return;

  const patch = map[filter as keyof typeof map];
  if (patch === undefined) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[listing] Unknown filter value ignored: "${filter}"`);
    }
    return;
  }

  Object.assign(where, patch);
}
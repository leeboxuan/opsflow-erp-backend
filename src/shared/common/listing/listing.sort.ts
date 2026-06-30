export function buildOrderBy(
  sortBy: string | undefined,
  sortDir: string | undefined,
  allowed: readonly string[],
  fallback: Record<string, "asc" | "desc">
) {
  const dir: "asc" | "desc" = sortDir === "desc" ? "desc" : "asc";

  if (!sortBy) return fallback;
  if (!allowed.includes(sortBy)) return fallback;

  return { [sortBy]: dir } as any;
}
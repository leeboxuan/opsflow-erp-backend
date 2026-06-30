/**
 * Apply generic search (q) to a Prisma where clause.
 * Builds where.OR with contains + mode: "insensitive" for each field.
 * If where.OR already exists, appends conditions (does not overwrite).
 */
export function applyQSearch(
  where: Record<string, any>,
  q: string | undefined,
  fields: string[]
): void {
  const term = typeof q === "string" ? q.trim() : "";
  if (!term || fields.length === 0) return;

  const orClause = fields.map((field) => ({
    [field]: { contains: term, mode: "insensitive" as const },
  }));

  if (where.OR !== undefined) {
    const existing = Array.isArray(where.OR) ? where.OR : [where.OR];
    where.OR = [...existing, ...orClause];
  } else {
    where.OR = orClause;
  }
}

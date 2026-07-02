/**
 * Derives a short uppercase initial code from a user display name or email local-part.
 * Examples: "Mary U" -> "MU", "mary.u@example.com" -> "MU"
 */
export function resolveUserInitial(
  displayName?: string | null,
  name?: string | null,
  email?: string | null,
): string {
  const source = displayName?.trim() || name?.trim() || email?.trim() || '';
  if (!source) return 'XX';

  if (source.includes('@')) {
    const local = source.split('@')[0] ?? '';
    const parts = local.split(/[._\-\s]+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
    }
    return local.slice(0, 2).toUpperCase() || 'XX';
  }

  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase() || 'XX';
}

/**
 * Formats a warehouse customer reference:
 * DB-<creatorInitial> <YY><customerInitial>#<seq>
 * Example: DB-MU 26KAT#1207
 */
export function formatWarehouseCustomerReference(
  creatorInitial: string,
  yy: string,
  customerInitial: string,
  seq: number,
): string {
  const creator = creatorInitial.trim().toUpperCase();
  const customer = customerInitial.trim().toUpperCase();
  return `DB-${creator} ${yy}${customer}#${seq}`;
}

export function warehouseCustomerRefYear(now: Date = new Date()): string {
  return String(now.getUTCFullYear()).slice(-2);
}

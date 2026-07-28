/** Controlled domain for synthetic Supabase Auth emails (never show to clients). */
export const AUTH_INTERNAL_EMAIL_DOMAIN = 'auth.opsflow.app';

const USERNAME_PATTERN = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;

/**
 * Normalize a login username: trim, lowercase, collapse internal whitespace to none.
 * Allowed chars after normalize: a-z, 0-9, `.`, `_`, `-` (no leading/trailing separators).
 */
export function normalizeUsername(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

export function assertValidUsername(normalized: string): void {
  if (!normalized || normalized.length < 2 || normalized.length > 64) {
    throw new Error('Username must be 2–64 characters');
  }
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new Error(
      'Username may only contain letters, numbers, dots, underscores, and hyphens',
    );
  }
}

export function buildInternalAuthEmail(
  tenantSlug: string,
  normalizedUsername: string,
): string {
  const slug = String(tenantSlug ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  if (!slug) {
    throw new Error('Tenant slug is required for internal auth email');
  }
  assertValidUsername(normalizedUsername);
  return `${slug}.${normalizedUsername}@${AUTH_INTERNAL_EMAIL_DOMAIN}`;
}

export function isInternalAuthEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${AUTH_INTERNAL_EMAIL_DOMAIN}`);
}

/** Strip internal emails from API payloads. */
export function publicEmailOrNull(
  email: string | null | undefined,
): string | null {
  if (!email || isInternalAuthEmail(email)) return null;
  return email;
}

/** Controlled domain for synthetic Supabase Auth emails (never show to clients). */
export const AUTH_INTERNAL_EMAIL_DOMAIN = 'auth.opsflow.app';

const USERNAME_PATTERN = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;

/**
 * Canonical form used for create, login, uniqueness, and audit SQL:
 * trim, lowercase, strip every JS `\s+` run (spaces, tabs, newlines, and other
 * JS whitespace). PostgreSQL enforces the same practical ASCII identity with
 * `lower(regexp_replace(username, '[[:space:]]+', '', 'g'))`.
 * JS `\s` includes additional Unicode separators (e.g. NBSP) that POSIX
 * `[[:space:]]` may not; OpsFlow usernames are ASCII `[a-z0-9._-]`.
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

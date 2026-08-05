export const DEFAULT_TENANT_TIMEZONE = "Asia/Singapore";

/**
 * Return a valid IANA timezone for authenticated tenant context.
 *
 * Tenant.timezone is authoritative when valid. Missing or legacy-invalid
 * values use the established application fallback.
 */
export function getSafeTenantTimezone(value?: string | null): string {
  const timezone = value?.trim() || DEFAULT_TENANT_TIMEZONE;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TENANT_TIMEZONE;
  }
}

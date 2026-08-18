import { MembershipStatus, TenantStatus } from "@prisma/client";

export type SessionMembershipAccessInput = {
  tenantId?: string | null;
  status?: string | null;
  tenant?: { status?: string | null } | null;
};

/** Ordinary session tenants: SETUP or ACTIVE (missing treated as ACTIVE for legacy rows). */
export function isOrdinaryTenantStatusAccessible(
  status?: string | null,
): boolean {
  if (!status) return true;
  return status === TenantStatus.ACTIVE || status === TenantStatus.SETUP;
}

export function isMembershipStatusActive(status?: string | null): boolean {
  return status === MembershipStatus.Active || status === "Active";
}

export function isOrdinaryMembershipAccessible(
  membership: SessionMembershipAccessInput | null | undefined,
): boolean {
  if (!membership?.tenantId) return false;
  if (!isMembershipStatusActive(membership.status)) return false;
  return isOrdinaryTenantStatusAccessible(membership.tenant?.status ?? null);
}

/**
 * Memberships returned to /auth/me and login.
 * Ordinary users: Active membership + non-suspended/archived tenant.
 * Platform admins: omit ARCHIVED tenants (ops blocked); keep SUSPENDED for management.
 */
export function filterVisibleSessionMemberships<T extends Record<string, any>>(
  memberships: T[],
  isPlatformAdmin: boolean,
): T[] {
  if (isPlatformAdmin) {
    return memberships.filter(
      (membership) => membership.tenant?.status !== TenantStatus.ARCHIVED,
    );
  }
  return memberships.filter((membership) => isOrdinaryMembershipAccessible(membership));
}

/** Header tenantId is trusted only when it matches a visible (accessible) membership. */
export function resolveRequestedMembershipTenantId(input: {
  requestedTenantId?: string | null;
  visibleMemberships: Array<{ tenantId: string }>;
}): string | undefined {
  const requested = input.requestedTenantId?.trim() ?? "";
  if (!requested) return undefined;
  const match = input.visibleMemberships.find((m) => m.tenantId === requested);
  return match?.tenantId;
}

export function isPlatformOperatedTenantAllowed(status?: string | null): boolean {
  return status !== TenantStatus.ARCHIVED && status !== "ARCHIVED";
}

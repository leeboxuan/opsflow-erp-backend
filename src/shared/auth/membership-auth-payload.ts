import { CanonicalTenantRole, Role } from '@prisma/client';
import {
  resolveCanonicalRoles,
  toLegacyCompatibilityRole,
  type RoleLike,
} from './canonical-tenant-role';

export type MembershipAuthShape = {
  tenantId: string;
  role: RoleLike;
  status: string;
  membershipRoles?: Array<{ role?: RoleLike }> | null;
  tenant: {
    id: string;
    name: string;
    status?: string | null;
    timezone?: string | null;
    modules?: Array<{ module: string; enabled: boolean }> | null;
    moduleEntitlements?: Array<{ module: string; enabled: boolean }> | null;
  };
};

export function toTenantModulesDto(
  tenant:
    | {
        modules?: Array<{ module: string; enabled: boolean }> | null;
        moduleEntitlements?: Array<{ module: string; enabled: boolean }> | null;
      }
    | null
    | undefined,
): Array<{ module: string; enabled: boolean }> {
  const rows = tenant?.moduleEntitlements ?? tenant?.modules;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    module: String(row.module),
    enabled: row.enabled === true,
  }));
}

export function toMembershipAuthDto(membership: MembershipAuthShape) {
  const roles = resolveCanonicalRoles(membership);
  const compatibilityRole =
    toLegacyCompatibilityRole(roles, membership.role) ??
    (membership.role as Role);
  return {
    tenantId: membership.tenantId,
    /** @deprecated Singular compatibility projection. Use `roles`. */
    role: compatibilityRole,
    roles,
    status: membership.status,
    tenant: {
      id: membership.tenant.id,
      name: membership.tenant.name,
      status: membership.tenant.status ?? undefined,
      timezone: membership.tenant.timezone ?? undefined,
      modules: toTenantModulesDto(membership.tenant),
    },
  };
}

export function activeUserAuthRoles(membership: MembershipAuthShape | null | undefined): {
  role: Role | null;
  roles: CanonicalTenantRole[];
  tenantId?: string;
} {
  if (!membership) {
    return { role: null, roles: [] };
  }
  const payload = toMembershipAuthDto(membership);
  return {
    role: payload.role as Role,
    roles: payload.roles,
    tenantId: payload.tenantId,
  };
}

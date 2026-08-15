import { BadRequestException } from '@nestjs/common';
import { CanonicalTenantRole, Prisma, Role } from '@prisma/client';
import {
  isTransportStaffRole,
  TRANSPORT_STAFF_COMPAT_ROLES,
} from '../shared/auth/role-compat';
import {
  CANONICAL_TO_LEGACY_ROLE,
  toCanonicalTenantRole,
} from '../shared/auth/canonical-tenant-role';

const LEGACY_ROLE_SET = new Set<string>(Object.values(Role));

export type ParsedTenantRoleFilter = {
  legacyRoles: Role[];
  canonicalRoles: CanonicalTenantRole[];
};

/**
 * Parse role query filters.
 * Accepts legacy Role values and canonical tenant roles.
 * Transport-staff aliases expand to OPS + TRANSPORT_STAFF + TRANSPORT_ADMIN.
 */
export function parseTenantRoleListFilter(
  role?: Role | string,
  roles?: string,
): ParsedTenantRoleFilter | undefined {
  let tokens: string[] | undefined;

  if (role) {
    tokens = [String(role)];
  } else if (roles?.trim()) {
    tokens = roles
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if (!tokens?.length) return undefined;

  const invalid = tokens.filter(
    (value) => !LEGACY_ROLE_SET.has(value) && !toCanonicalTenantRole(value),
  );
  if (invalid.length) {
    throw new BadRequestException(`Invalid role filter: ${invalid.join(', ')}`);
  }

  const legacy = new Set<Role>();
  const canonical = new Set<CanonicalTenantRole>();
  let includesTransportStaff = false;

  for (const value of tokens) {
    const mapped = toCanonicalTenantRole(value);
    if (mapped) canonical.add(mapped);
    if (isTransportStaffRole(value) || mapped === CanonicalTenantRole.TRANSPORT_ADMIN) {
      includesTransportStaff = true;
      continue;
    }
    if (LEGACY_ROLE_SET.has(value)) {
      legacy.add(value as Role);
    } else if (mapped) {
      legacy.add(CANONICAL_TO_LEGACY_ROLE[mapped]);
    }
  }

  if (includesTransportStaff) {
    for (const value of TRANSPORT_STAFF_COMPAT_ROLES) {
      legacy.add(value);
    }
    canonical.add(CanonicalTenantRole.TRANSPORT_ADMIN);
  }

  return {
    legacyRoles: [...legacy],
    canonicalRoles: [...canonical],
  };
}

/**
 * Legacy helper: returns Role[] for the membership.role column filter.
 */
export function parseTenantRoleFilter(
  role?: Role | string,
  roles?: string,
): Role[] | undefined {
  return parseTenantRoleListFilter(role, roles)?.legacyRoles;
}

export function tenantRoleFilterWhere(
  parsed: ParsedTenantRoleFilter,
): Prisma.TenantMembershipWhereInput {
  const clauses: Prisma.TenantMembershipWhereInput[] = [];
  if (parsed.legacyRoles.length) {
    clauses.push({ role: { in: parsed.legacyRoles } });
  }
  if (parsed.canonicalRoles.length) {
    clauses.push({
      membershipRoles: { some: { role: { in: parsed.canonicalRoles } } },
    });
  }
  if (!clauses.length) return {};
  if (clauses.length === 1) return clauses[0];
  return { OR: clauses };
}

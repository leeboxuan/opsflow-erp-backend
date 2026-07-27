import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  isTransportStaffRole,
  TRANSPORT_STAFF_COMPAT_ROLES,
} from '../shared/auth/role-compat';

const ALL_ROLES = new Set<string>(Object.values(Role));

/**
 * Parse role query filters. During the OPS↔TRANSPORT_STAFF compatibility window,
 * requesting either transport-staff value expands to both so lists still find
 * legacy OPS memberships (and any future TRANSPORT_STAFF rows).
 */
export function parseTenantRoleFilter(
  role?: Role,
  roles?: string,
): Role[] | undefined {
  let parsed: Role[] | undefined;

  if (role) {
    parsed = [role];
  } else if (roles?.trim()) {
    const tokens = roles
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const invalid = tokens.filter((value) => !ALL_ROLES.has(value));
    if (invalid.length > 0) {
      throw new BadRequestException(`Invalid role filter: ${invalid.join(', ')}`);
    }

    parsed = tokens as Role[];
  }

  if (!parsed?.length) return undefined;

  const expanded = new Set<Role>();
  let includesTransportStaff = false;
  for (const value of parsed) {
    if (isTransportStaffRole(value)) {
      includesTransportStaff = true;
      continue;
    }
    expanded.add(value);
  }
  if (includesTransportStaff) {
    for (const value of TRANSPORT_STAFF_COMPAT_ROLES) {
      expanded.add(value);
    }
  }

  return [...expanded];
}

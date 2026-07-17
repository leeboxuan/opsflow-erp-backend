import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';

const ALL_ROLES = new Set<string>(Object.values(Role));

export function parseTenantRoleFilter(
  role?: Role,
  roles?: string,
): Role[] | undefined {
  if (role) return [role];
  if (!roles?.trim()) return undefined;

  const parsed = roles
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const invalid = parsed.filter((value) => !ALL_ROLES.has(value));
  if (invalid.length > 0) {
    throw new BadRequestException(`Invalid role filter: ${invalid.join(', ')}`);
  }

  return parsed as Role[];
}

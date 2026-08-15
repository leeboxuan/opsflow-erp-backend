import { CanonicalTenantRole, Prisma, Role } from '@prisma/client';
import {
  resolveCanonicalRoles,
  sortCanonicalRoles,
  toLegacyCompatibilityRole,
  type RoleLike,
} from './canonical-tenant-role';

export type MembershipRoleRow = {
  role: CanonicalTenantRole;
};

export async function syncMembershipRoleRows(
  tx: Prisma.TransactionClient | {
    tenantMembershipRole: {
      findMany: (args: unknown) => Promise<Array<{ id: string; role: CanonicalTenantRole }>>;
      deleteMany: (args: unknown) => Promise<unknown>;
      createMany: (args: unknown) => Promise<unknown>;
    };
  },
  membershipId: string,
  roles: readonly CanonicalTenantRole[],
  createdByUserId?: string | null,
): Promise<void> {
  const unique = sortCanonicalRoles([...new Set(roles)]);
  const existing = await tx.tenantMembershipRole.findMany({
    where: { tenantMembershipId: membershipId },
    select: { id: true, role: true },
  } as any);

  const next = new Set(unique);
  const toDelete = existing.filter((row) => !next.has(row.role));
  if (toDelete.length) {
    await tx.tenantMembershipRole.deleteMany({
      where: { id: { in: toDelete.map((row) => row.id) } },
    } as any);
  }

  const existingSet = new Set(existing.map((row) => row.role));
  const toCreate = unique.filter((role) => !existingSet.has(role));
  if (toCreate.length) {
    await tx.tenantMembershipRole.createMany({
      data: toCreate.map((role) => ({
        tenantMembershipId: membershipId,
        role,
        createdByUserId: createdByUserId ?? null,
      })),
    } as any);
  }
}

export function legacyRoleForCanonicalSet(
  roles: readonly CanonicalTenantRole[],
  fallbackLegacy?: RoleLike,
): Role {
  return (
    toLegacyCompatibilityRole(roles, fallbackLegacy) ??
    Role.TRANSPORT_STAFF
  );
}

export function canonicalRolesFromMembership(membership: {
  role?: RoleLike;
  membershipRoles?: Array<{ role?: RoleLike }> | null;
  roles?: readonly RoleLike[] | null;
}): CanonicalTenantRole[] {
  return sortCanonicalRoles(resolveCanonicalRoles(membership));
}

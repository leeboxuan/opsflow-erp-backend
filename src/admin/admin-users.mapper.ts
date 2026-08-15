import { CanonicalTenantRole, MembershipStatus, Role } from '@prisma/client';
import { publicEmailOrNull } from '../shared/auth/auth-internal-email';
import {
  isWarehouseStaffRole,
  resolveCanonicalRoles,
  toLegacyCompatibilityRole,
  type RoleLike,
} from '../shared/auth/canonical-tenant-role';

export type TenantMembershipUserRow = {
  id: string;
  role: Role;
  status: MembershipStatus;
  membershipRoles?: Array<{ role?: RoleLike }> | null;
  user: {
    id: string;
    email: string;
    username?: string | null;
    name: string | null;
    phone?: string | null;
    customerCompanyId?: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
};

export type PublicAdminUserDto = {
  id: string;
  email: string | null;
  username: string | null;
  name: string | null;
  phone: string | null;
  /** @deprecated Singular compatibility projection. Use `roles`. */
  role: Role;
  roles: CanonicalTenantRole[];
  status: MembershipStatus;
  membershipId: string;
  customerCompanyId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
};

/** Shared list/create/update response shape — never exposes internal auth emails. */
export function mapTenantMembershipToPublicUserDto(
  membership: TenantMembershipUserRow,
): PublicAdminUserDto {
  const roles = resolveCanonicalRoles(membership);
  const compatibilityRole =
    toLegacyCompatibilityRole(roles, membership.role) ?? membership.role;
  return {
    id: membership.user.id,
    email: publicEmailOrNull(membership.user.email),
    username: membership.user.username ?? null,
    name: membership.user.name,
    phone: membership.user.phone ?? null,
    role: compatibilityRole,
    roles,
    status: membership.status,
    membershipId: membership.id,
    customerCompanyId: membership.user.customerCompanyId ?? null,
    createdAt: membership.user.createdAt,
    updatedAt: membership.user.updatedAt,
    lastLoginAt: null,
  };
}

/** Username/password operational accounts (warehouse mobile). */
export function isUsernamePasswordOperationalUser(user: {
  role?: Role | string | null;
  roles?: readonly RoleLike[] | null;
  username?: string | null;
  email?: string | null;
}): boolean {
  if (isWarehouseStaffRole(user.role)) return true;
  if (user.roles?.some((role) => isWarehouseStaffRole(role))) return true;
  if (user.username?.trim()) return true;
  const email = user.email?.trim().toLowerCase() ?? '';
  return email.endsWith('@auth.opsflow.app');
}

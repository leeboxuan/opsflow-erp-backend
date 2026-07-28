import { MembershipStatus, Role } from '@prisma/client';
import { publicEmailOrNull } from '../shared/auth/auth-internal-email';

export type TenantMembershipUserRow = {
  id: string;
  role: Role;
  status: MembershipStatus;
  user: {
    id: string;
    email: string;
    username?: string | null;
    name: string | null;
    phone?: string | null;
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
  role: Role;
  status: MembershipStatus;
  membershipId: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
};

/** Shared list/create/update response shape — never exposes internal auth emails. */
export function mapTenantMembershipToPublicUserDto(
  membership: TenantMembershipUserRow,
): PublicAdminUserDto {
  return {
    id: membership.user.id,
    email: publicEmailOrNull(membership.user.email),
    username: membership.user.username ?? null,
    name: membership.user.name,
    phone: membership.user.phone ?? null,
    role: membership.role,
    status: membership.status,
    membershipId: membership.id,
    createdAt: membership.user.createdAt,
    updatedAt: membership.user.updatedAt,
    lastLoginAt: null,
  };
}

/** Username/password operational accounts (warehouse mobile). */
export function isUsernamePasswordOperationalUser(user: {
  role?: Role | string | null;
  username?: string | null;
  email?: string | null;
}): boolean {
  const role = String(user.role ?? '').toUpperCase();
  if (role === Role.WAREHOUSE) return true;
  if (user.username?.trim()) return true;
  const email = user.email?.trim().toLowerCase() ?? '';
  return email.endsWith('@auth.opsflow.app');
}

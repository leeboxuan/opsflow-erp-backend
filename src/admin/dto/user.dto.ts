import { CanonicalTenantRole, MembershipStatus, Role } from '@prisma/client';

export class UserDto {
  id!: string;
  /** Real email when present; null for username-based (internal auth) users. */
  email!: string | null;
  username?: string | null;
  name!: string | null;
  phone?: string | null;
  /** @deprecated Singular compatibility projection. Use `roles`. */
  role!: Role;
  roles!: CanonicalTenantRole[];
  status!: MembershipStatus;
  membershipId!: string;
  customerCompanyId?: string | null;
  createdAt!: Date;
  updatedAt!: Date;
  lastLoginAt?: Date | null;
}

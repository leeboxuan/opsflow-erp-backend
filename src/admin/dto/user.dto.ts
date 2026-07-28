import { MembershipStatus, Role } from '@prisma/client';

export class UserDto {
  id!: string;
  /** Real email when present; null for username-based (internal auth) users. */
  email!: string | null;
  username?: string | null;
  name!: string | null;
  phone?: string | null;
  role!: Role;
  status!: MembershipStatus;
  membershipId!: string;
  createdAt!: Date;
  updatedAt!: Date;
  lastLoginAt?: Date | null;
}

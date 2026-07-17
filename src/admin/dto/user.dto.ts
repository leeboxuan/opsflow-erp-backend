import { MembershipStatus, Role } from '@prisma/client';

export class UserDto {
  id!: string;
  email!: string;
  name!: string | null;
  phone?: string | null;
  role!: Role;
  status!: MembershipStatus;
  membershipId!: string;
  createdAt!: Date;
  updatedAt!: Date;
}

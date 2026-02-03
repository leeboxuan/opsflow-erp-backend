import { Role, MembershipStatus } from '@prisma/client';
export declare class UpdateMembershipDto {
    role?: Role;
    status?: MembershipStatus;
}

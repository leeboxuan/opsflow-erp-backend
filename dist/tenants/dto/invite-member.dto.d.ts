import { Role } from '@prisma/client';
export declare class InviteMemberDto {
    email: string;
    role: Role;
    name?: string;
}

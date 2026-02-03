import { PrismaService } from '../prisma/prisma.service';
import { MembershipStatus, Role } from '@prisma/client';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';
export interface TenantDto {
    id: string;
    name: string;
    slug: string;
    role: Role;
    createdAt: Date;
}
export interface MemberDto {
    id: string;
    userId: string;
    email: string;
    name: string | null;
    role: Role;
    status: MembershipStatus;
    createdAt: Date;
    updatedAt: Date;
}
export declare class TenantsController {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getTenants(req: any): Promise<TenantDto[]>;
    getCurrentTenant(req: any): Promise<{
        id: string;
        name: string;
        slug: string;
        role: any;
        createdAt: Date;
        updatedAt: Date;
    }>;
    getMembers(req: any): Promise<MemberDto[]>;
    inviteMember(req: any, dto: InviteMemberDto): Promise<MemberDto>;
    updateMembership(req: any, membershipId: string, dto: UpdateMembershipDto): Promise<MemberDto>;
}

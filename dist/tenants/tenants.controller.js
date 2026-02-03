"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_guard_1 = require("../auth/guards/auth.guard");
const tenant_guard_1 = require("../auth/guards/tenant.guard");
const role_guard_1 = require("../auth/guards/role.guard");
const role_guard_2 = require("../auth/guards/role.guard");
const prisma_service_1 = require("../prisma/prisma.service");
const client_1 = require("@prisma/client");
const invite_member_dto_1 = require("./dto/invite-member.dto");
const update_membership_dto_1 = require("./dto/update-membership.dto");
let TenantsController = class TenantsController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getTenants(req) {
        const user = req.user;
        if (!user || !user.userId) {
            return [];
        }
        const memberships = await this.prisma.tenantMembership.findMany({
            where: {
                userId: user.userId,
                status: client_1.MembershipStatus.Active,
            },
            include: {
                tenant: true,
            },
            orderBy: {
                tenant: {
                    name: 'asc',
                },
            },
        });
        return memberships.map((membership) => ({
            id: membership.tenant.id,
            name: membership.tenant.name,
            slug: membership.tenant.slug,
            role: membership.role,
            createdAt: membership.tenant.createdAt,
        }));
    }
    async getCurrentTenant(req) {
        const tenantId = req.tenant.tenantId;
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
        });
        if (!tenant) {
            throw new common_1.NotFoundException('Tenant not found');
        }
        return {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            role: req.tenant.role,
            createdAt: tenant.createdAt,
            updatedAt: tenant.updatedAt,
        };
    }
    async getMembers(req) {
        const tenantId = req.tenant.tenantId;
        const memberships = await this.prisma.tenantMembership.findMany({
            where: {
                tenantId,
            },
            include: {
                user: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
        return memberships.map((membership) => ({
            id: membership.id,
            userId: membership.userId,
            email: membership.user.email,
            name: membership.user.name,
            role: membership.role,
            status: membership.status,
            createdAt: membership.createdAt,
            updatedAt: membership.updatedAt,
        }));
    }
    async inviteMember(req, dto) {
        const tenantId = req.tenant.tenantId;
        const user = await this.prisma.user.upsert({
            where: { email: dto.email },
            update: {},
            create: {
                email: dto.email,
                name: dto.name || null,
            },
        });
        const existing = await this.prisma.tenantMembership.findUnique({
            where: {
                tenantId_userId: {
                    tenantId,
                    userId: user.id,
                },
            },
        });
        if (existing) {
            throw new common_1.BadRequestException('User is already a member of this tenant');
        }
        const membership = await this.prisma.tenantMembership.create({
            data: {
                tenantId,
                userId: user.id,
                role: dto.role,
                status: client_1.MembershipStatus.Invited,
            },
            include: {
                user: true,
            },
        });
        return {
            id: membership.id,
            userId: membership.userId,
            email: membership.user.email,
            name: membership.user.name,
            role: membership.role,
            status: membership.status,
            createdAt: membership.createdAt,
            updatedAt: membership.updatedAt,
        };
    }
    async updateMembership(req, membershipId, dto) {
        const tenantId = req.tenant.tenantId;
        const membership = await this.prisma.tenantMembership.findFirst({
            where: {
                id: membershipId,
                tenantId,
            },
            include: {
                user: true,
            },
        });
        if (!membership) {
            throw new common_1.NotFoundException('Membership not found');
        }
        const updated = await this.prisma.tenantMembership.update({
            where: { id: membershipId },
            data: {
                ...(dto.role !== undefined && { role: dto.role }),
                ...(dto.status !== undefined && { status: dto.status }),
            },
            include: {
                user: true,
            },
        });
        return {
            id: updated.id,
            userId: updated.userId,
            email: updated.user.email,
            name: updated.user.name,
            role: updated.role,
            status: updated.status,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
        };
    }
};
exports.TenantsController = TenantsController;
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    (0, swagger_1.ApiBearerAuth)('JWT-auth'),
    (0, swagger_1.ApiOperation)({ summary: 'Get all tenants for current user' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TenantsController.prototype, "getTenants", null);
__decorate([
    (0, common_1.Get)('me'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard, tenant_guard_1.TenantGuard),
    (0, swagger_1.ApiBearerAuth)('JWT-auth'),
    (0, swagger_1.ApiOperation)({ summary: 'Get current tenant information' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TenantsController.prototype, "getCurrentTenant", null);
__decorate([
    (0, common_1.Get)('members'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard, tenant_guard_1.TenantGuard, role_guard_1.RoleGuard),
    (0, role_guard_2.Roles)(client_1.Role.Admin, client_1.Role.Ops),
    (0, swagger_1.ApiBearerAuth)('JWT-auth'),
    (0, swagger_1.ApiOperation)({ summary: 'List all members of current tenant (Admin/Ops only)' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TenantsController.prototype, "getMembers", null);
__decorate([
    (0, common_1.Post)('invite'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard, tenant_guard_1.TenantGuard, role_guard_1.RoleGuard),
    (0, role_guard_2.Roles)(client_1.Role.Admin),
    (0, swagger_1.ApiBearerAuth)('JWT-auth'),
    (0, swagger_1.ApiOperation)({ summary: 'Invite a user to join the tenant (Admin only)' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, invite_member_dto_1.InviteMemberDto]),
    __metadata("design:returntype", Promise)
], TenantsController.prototype, "inviteMember", null);
__decorate([
    (0, common_1.Patch)('members/:membershipId'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard, tenant_guard_1.TenantGuard, role_guard_1.RoleGuard),
    (0, role_guard_2.Roles)(client_1.Role.Admin),
    (0, swagger_1.ApiBearerAuth)('JWT-auth'),
    (0, swagger_1.ApiOperation)({ summary: 'Update membership status or role (Admin only)' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('membershipId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_membership_dto_1.UpdateMembershipDto]),
    __metadata("design:returntype", Promise)
], TenantsController.prototype, "updateMembership", null);
exports.TenantsController = TenantsController = __decorate([
    (0, swagger_1.ApiTags)('tenants'),
    (0, common_1.Controller)('tenants'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TenantsController);
//# sourceMappingURL=tenants.controller.js.map
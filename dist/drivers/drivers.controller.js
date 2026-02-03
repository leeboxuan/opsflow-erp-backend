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
exports.DriversController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_guard_1 = require("../auth/guards/auth.guard");
const tenant_guard_1 = require("../auth/guards/tenant.guard");
const prisma_service_1 = require("../prisma/prisma.service");
const update_driver_dto_1 = require("./dto/update-driver.dto");
let DriversController = class DriversController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getDriverMe(req) {
        const userId = req.user.userId;
        const tenantId = req.tenant.tenantId;
        const membership = await this.prisma.tenantMembership.findUnique({
            where: {
                tenantId_userId: {
                    tenantId,
                    userId,
                },
            },
            include: {
                user: true,
            },
        });
        if (!membership) {
            throw new common_1.NotFoundException('Driver profile not found');
        }
        return {
            id: membership.user.id,
            email: membership.user.email,
            name: membership.user.name,
            role: membership.role,
            createdAt: membership.user.createdAt,
            updatedAt: membership.user.updatedAt,
        };
    }
    async updateDriverMe(req, dto) {
        const userId = req.user.userId;
        const tenantId = req.tenant.tenantId;
        const user = await this.prisma.user.update({
            where: { id: userId },
            data: {
                ...(dto.name !== undefined && { name: dto.name }),
            },
        });
        const membership = await this.prisma.tenantMembership.findUnique({
            where: {
                tenantId_userId: {
                    tenantId,
                    userId,
                },
            },
        });
        if (!membership) {
            throw new common_1.NotFoundException('Driver profile not found');
        }
        return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: membership.role,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };
    }
};
exports.DriversController = DriversController;
__decorate([
    (0, common_1.Get)('me'),
    (0, swagger_1.ApiOperation)({ summary: 'Get current user driver profile' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "getDriverMe", null);
__decorate([
    (0, common_1.Patch)('me'),
    (0, swagger_1.ApiOperation)({ summary: 'Update current user driver profile' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, update_driver_dto_1.UpdateDriverDto]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "updateDriverMe", null);
exports.DriversController = DriversController = __decorate([
    (0, swagger_1.ApiTags)('drivers'),
    (0, common_1.Controller)('drivers'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard, tenant_guard_1.TenantGuard),
    (0, swagger_1.ApiBearerAuth)('JWT-auth'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DriversController);
//# sourceMappingURL=drivers.controller.js.map
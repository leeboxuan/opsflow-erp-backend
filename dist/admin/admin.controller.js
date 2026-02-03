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
exports.AdminController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_guard_1 = require("../auth/guards/auth.guard");
const tenant_guard_1 = require("../auth/guards/tenant.guard");
const role_guard_1 = require("../auth/guards/role.guard");
const role_guard_2 = require("../auth/guards/role.guard");
const prisma_service_1 = require("../prisma/prisma.service");
const location_service_1 = require("../driver/location.service");
const client_1 = require("@prisma/client");
const create_driver_dto_1 = require("./dto/create-driver.dto");
const create_vehicle_dto_1 = require("./dto/create-vehicle.dto");
let AdminController = class AdminController {
    constructor(prisma, locationService) {
        this.prisma = prisma;
        this.locationService = locationService;
    }
    async getDrivers(req) {
        const tenantId = req.tenant.tenantId;
        const memberships = await this.prisma.tenantMembership.findMany({
            where: {
                tenantId,
                role: client_1.Role.Driver,
                status: client_1.MembershipStatus.Active,
            },
            include: {
                user: true,
            },
            orderBy: {
                user: {
                    name: 'asc',
                },
            },
        });
        return memberships.map((membership) => ({
            id: membership.user.id,
            email: membership.user.email,
            name: membership.user.name,
            phone: membership.user.phone,
            role: membership.role,
            membershipId: membership.id,
            createdAt: membership.user.createdAt,
            updatedAt: membership.user.updatedAt,
        }));
    }
    async createDriver(req, dto) {
        const tenantId = req.tenant.tenantId;
        const user = await this.prisma.user.upsert({
            where: { email: dto.email },
            update: {
                name: dto.name || undefined,
                phone: dto.phone || undefined,
            },
            create: {
                email: dto.email,
                name: dto.name || null,
                phone: dto.phone || null,
            },
        });
        const existingMembership = await this.prisma.tenantMembership.findUnique({
            where: {
                tenantId_userId: {
                    tenantId,
                    userId: user.id,
                },
            },
        });
        if (existingMembership) {
            const membership = existingMembership.role === client_1.Role.Driver
                ? existingMembership
                : await this.prisma.tenantMembership.update({
                    where: { id: existingMembership.id },
                    data: { role: client_1.Role.Driver },
                });
            return {
                id: user.id,
                email: user.email,
                name: user.name,
                phone: user.phone,
                role: membership.role,
                membershipId: membership.id,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
            };
        }
        const membership = await this.prisma.tenantMembership.create({
            data: {
                tenantId,
                userId: user.id,
                role: client_1.Role.Driver,
                status: client_1.MembershipStatus.Active,
            },
        });
        return {
            id: user.id,
            email: user.email,
            name: user.name,
            phone: user.phone,
            role: membership.role,
            membershipId: membership.id,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };
    }
    async getVehicles(req) {
        const tenantId = req.tenant.tenantId;
        const vehicles = await this.prisma.vehicle.findMany({
            where: { tenantId },
            orderBy: {
                vehicleNumber: 'asc',
            },
        });
        return vehicles.map((vehicle) => ({
            id: vehicle.id,
            vehicleNumber: vehicle.vehicleNumber,
            type: vehicle.type,
            notes: vehicle.notes,
            createdAt: vehicle.createdAt,
            updatedAt: vehicle.updatedAt,
        }));
    }
    async createVehicle(req, dto) {
        const tenantId = req.tenant.tenantId;
        const existing = await this.prisma.vehicle.findUnique({
            where: {
                tenantId_vehicleNumber: {
                    tenantId,
                    vehicleNumber: dto.vehicleNumber,
                },
            },
        });
        if (existing) {
            throw new common_1.BadRequestException('Vehicle with this number already exists for this tenant');
        }
        const vehicle = await this.prisma.vehicle.create({
            data: {
                tenantId,
                vehicleNumber: dto.vehicleNumber,
                type: dto.type || null,
                notes: dto.notes || null,
            },
        });
        return {
            id: vehicle.id,
            vehicleNumber: vehicle.vehicleNumber,
            type: vehicle.type,
            notes: vehicle.notes,
            createdAt: vehicle.createdAt,
            updatedAt: vehicle.updatedAt,
        };
    }
    async getLocations(req) {
        const tenantId = req.tenant.tenantId;
        return this.locationService.getAllDriverLocations(tenantId);
    }
};
exports.AdminController = AdminController;
__decorate([
    (0, common_1.Get)('drivers'),
    (0, swagger_1.ApiOperation)({ summary: 'List all drivers (Admin/Ops only)' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getDrivers", null);
__decorate([
    (0, common_1.Post)('drivers'),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new driver (Admin/Ops only)' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_driver_dto_1.CreateDriverDto]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "createDriver", null);
__decorate([
    (0, common_1.Get)('vehicles'),
    (0, swagger_1.ApiOperation)({ summary: 'List all vehicles (Admin/Ops only)' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getVehicles", null);
__decorate([
    (0, common_1.Post)('vehicles'),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new vehicle (Admin/Ops only)' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_vehicle_dto_1.CreateVehicleDto]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "createVehicle", null);
__decorate([
    (0, common_1.Get)('locations'),
    (0, swagger_1.ApiOperation)({ summary: 'Get all driver locations (Admin/Ops only)' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getLocations", null);
exports.AdminController = AdminController = __decorate([
    (0, swagger_1.ApiTags)('admin'),
    (0, common_1.Controller)('admin'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard, tenant_guard_1.TenantGuard, role_guard_1.RoleGuard),
    (0, role_guard_2.Roles)(client_1.Role.Admin, client_1.Role.Ops),
    (0, swagger_1.ApiBearerAuth)('JWT-auth'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        location_service_1.LocationService])
], AdminController);
//# sourceMappingURL=admin.controller.js.map
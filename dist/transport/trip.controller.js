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
exports.TripController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_guard_1 = require("../auth/guards/auth.guard");
const tenant_guard_1 = require("../auth/guards/tenant.guard");
const role_guard_1 = require("../auth/guards/role.guard");
const role_guard_2 = require("../auth/guards/role.guard");
const trip_service_1 = require("./trip.service");
const create_trip_dto_1 = require("./dto/create-trip.dto");
const assign_driver_dto_1 = require("../driver/dto/assign-driver.dto");
const assign_vehicle_dto_1 = require("../driver/dto/assign-vehicle.dto");
const client_1 = require("@prisma/client");
let TripController = class TripController {
    constructor(tripService) {
        this.tripService = tripService;
    }
    async createTrip(req, dto) {
        const tenantId = req.tenant.tenantId;
        return this.tripService.createTrip(tenantId, dto);
    }
    async listTrips(req, cursor, limit) {
        const tenantId = req.tenant.tenantId;
        const limitNum = limit ? parseInt(limit, 10) : 20;
        return this.tripService.listTrips(tenantId, cursor, limitNum);
    }
    async getTrip(req, id) {
        const tenantId = req.tenant.tenantId;
        const trip = await this.tripService.getTripById(tenantId, id);
        if (!trip) {
            throw new common_1.NotFoundException('Trip not found');
        }
        return trip;
    }
    async dispatchTrip(req, id) {
        const tenantId = req.tenant.tenantId;
        return this.tripService.transitionStatus(tenantId, id, 'Dispatched');
    }
    async startTrip(req, id) {
        const tenantId = req.tenant.tenantId;
        return this.tripService.transitionStatus(tenantId, id, 'InTransit');
    }
    async completeTrip(req, id) {
        const tenantId = req.tenant.tenantId;
        return this.tripService.transitionStatus(tenantId, id, 'Delivered');
    }
    async getTripEvents(req, id) {
        const tenantId = req.tenant.tenantId;
        return this.tripService.getTripEvents(tenantId, id);
    }
    async assignDriver(req, tripId, dto) {
        const tenantId = req.tenant.tenantId;
        return this.tripService.assignDriver(tenantId, tripId, dto.driverUserId);
    }
    async assignVehicle(req, tripId, dto) {
        const tenantId = req.tenant.tenantId;
        return this.tripService.assignVehicle(tenantId, tripId, dto);
    }
};
exports.TripController = TripController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new trip' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_trip_dto_1.CreateTripDto]),
    __metadata("design:returntype", Promise)
], TripController.prototype, "createTrip", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'List trips' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('cursor')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], TripController.prototype, "listTrips", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get trip by ID' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TripController.prototype, "getTrip", null);
__decorate([
    (0, common_1.Post)(':id/dispatch'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_guard_2.Roles)(client_1.Role.Admin, client_1.Role.Ops),
    (0, swagger_1.ApiOperation)({ summary: 'Dispatch a trip (Admin/Ops only)' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TripController.prototype, "dispatchTrip", null);
__decorate([
    (0, common_1.Post)(':id/start'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_guard_2.Roles)(client_1.Role.Driver, client_1.Role.Ops, client_1.Role.Admin),
    (0, swagger_1.ApiOperation)({ summary: 'Start a trip (Driver/Ops/Admin)' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TripController.prototype, "startTrip", null);
__decorate([
    (0, common_1.Post)(':id/complete'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_guard_2.Roles)(client_1.Role.Driver, client_1.Role.Ops, client_1.Role.Admin),
    (0, swagger_1.ApiOperation)({ summary: 'Complete a trip (Driver/Ops/Admin)' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TripController.prototype, "completeTrip", null);
__decorate([
    (0, common_1.Get)(':id/events'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_guard_2.Roles)(client_1.Role.Driver, client_1.Role.Ops, client_1.Role.Admin),
    (0, swagger_1.ApiOperation)({ summary: 'Get trip events (Driver/Ops/Admin)' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TripController.prototype, "getTripEvents", null);
__decorate([
    (0, common_1.Post)(':tripId/assign-driver'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_guard_2.Roles)(client_1.Role.Admin, client_1.Role.Ops),
    (0, swagger_1.ApiOperation)({ summary: 'Assign driver to trip (Admin/Ops only)' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('tripId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, assign_driver_dto_1.AssignDriverDto]),
    __metadata("design:returntype", Promise)
], TripController.prototype, "assignDriver", null);
__decorate([
    (0, common_1.Post)(':tripId/assign-vehicle'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_guard_2.Roles)(client_1.Role.Admin, client_1.Role.Ops),
    (0, swagger_1.ApiOperation)({ summary: 'Assign vehicle to trip (Admin/Ops only)' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('tripId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, assign_vehicle_dto_1.AssignVehicleDto]),
    __metadata("design:returntype", Promise)
], TripController.prototype, "assignVehicle", null);
exports.TripController = TripController = __decorate([
    (0, swagger_1.ApiTags)('transport'),
    (0, common_1.Controller)('transport/trips'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard, tenant_guard_1.TenantGuard),
    (0, swagger_1.ApiBearerAuth)('JWT-auth'),
    __metadata("design:paramtypes", [trip_service_1.TripService])
], TripController);
//# sourceMappingURL=trip.controller.js.map
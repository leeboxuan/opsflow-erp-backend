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
exports.DriverController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_guard_1 = require("../auth/guards/auth.guard");
const tenant_guard_1 = require("../auth/guards/tenant.guard");
const role_guard_1 = require("../auth/guards/role.guard");
const role_guard_2 = require("../auth/guards/role.guard");
const trip_service_1 = require("../transport/trip.service");
const prisma_service_1 = require("../prisma/prisma.service");
const location_service_1 = require("./location.service");
const driver_mvp_service_1 = require("./driver-mvp.service");
const client_1 = require("@prisma/client");
const assign_vehicle_dto_1 = require("./dto/assign-vehicle.dto");
const update_location_dto_1 = require("./dto/update-location.dto");
const accept_trip_dto_1 = require("./dto/accept-trip.dto");
const complete_stop_dto_1 = require("./dto/complete-stop.dto");
let DriverController = class DriverController {
    constructor(tripService, prisma, locationService, driverMvpService) {
        this.tripService = tripService;
        this.prisma = prisma;
        this.locationService = locationService;
        this.driverMvpService = driverMvpService;
    }
    async getTripsByDate(req, date) {
        const tenantId = req.tenant.tenantId;
        const userId = req.user.userId;
        const dateStr = date ?? new Date().toISOString().slice(0, 10);
        return this.driverMvpService.getTripsByDate(tenantId, userId, dateStr);
    }
    async acceptTrip(req, tripId, dto) {
        const tenantId = req.tenant.tenantId;
        const userId = req.user.userId;
        return this.driverMvpService.acceptTrip(tenantId, userId, tripId, dto);
    }
    async startTrip(req, tripId) {
        const tenantId = req.tenant.tenantId;
        const userId = req.user.userId;
        return this.driverMvpService.startTrip(tenantId, userId, tripId);
    }
    async startStop(req, stopId) {
        const tenantId = req.tenant.tenantId;
        const userId = req.user.userId;
        return this.driverMvpService.startStop(tenantId, userId, stopId);
    }
    async completeStop(req, stopId, dto) {
        const tenantId = req.tenant.tenantId;
        const userId = req.user.userId;
        return this.driverMvpService.completeStop(tenantId, userId, stopId, dto);
    }
    async getWallet(req, month) {
        const tenantId = req.tenant.tenantId;
        const userId = req.user.userId;
        const monthStr = month ?? new Date().toISOString().slice(0, 7);
        return this.driverMvpService.getWallet(tenantId, userId, monthStr);
    }
    async selectVehicle(req, tripId, dto) {
        const tenantId = req.tenant.tenantId;
        const userId = req.user.userId;
        const trip = await this.prisma.trip.findFirst({
            where: {
                id: tripId,
                tenantId,
                assignedDriverId: userId,
            },
        });
        if (!trip) {
            throw new common_1.NotFoundException('Trip not found or not assigned to you');
        }
        return this.tripService.assignVehicle(tenantId, tripId, dto);
    }
    async updateLocation(req, dto) {
        const tenantId = req.tenant.tenantId;
        const userId = req.user.userId;
        return this.locationService.upsertLocation(tenantId, userId, dto);
    }
    async getMyLocation(req) {
        const tenantId = req.tenant.tenantId;
        const userId = req.user.userId;
        const location = await this.locationService.getLatestLocation(tenantId, userId);
        if (!location) {
            return { message: 'No location data available' };
        }
        return location;
    }
};
exports.DriverController = DriverController;
__decorate([
    (0, common_1.Get)('trips'),
    (0, swagger_1.ApiOperation)({ summary: 'Get trips for current driver by date (MVP: includes stops, delivery order summary, lock state)' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('date')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DriverController.prototype, "getTripsByDate", null);
__decorate([
    (0, common_1.Post)('trips/:tripId/accept'),
    (0, swagger_1.ApiOperation)({ summary: 'Accept trip with vehicleNo, trailerNo' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('tripId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, accept_trip_dto_1.AcceptTripDto]),
    __metadata("design:returntype", Promise)
], DriverController.prototype, "acceptTrip", null);
__decorate([
    (0, common_1.Post)('trips/:tripId/start'),
    (0, swagger_1.ApiOperation)({ summary: 'Start trip (all stops must be Pending)' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('tripId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DriverController.prototype, "startTrip", null);
__decorate([
    (0, common_1.Post)('stops/:stopId/start'),
    (0, swagger_1.ApiOperation)({ summary: 'Start stop (previous stop must be completed)' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('stopId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DriverController.prototype, "startStop", null);
__decorate([
    (0, common_1.Post)('stops/:stopId/complete'),
    (0, swagger_1.ApiOperation)({ summary: 'Complete stop with POD photo keys; updates order; closes trip and wallet on final stop' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('stopId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, complete_stop_dto_1.CompleteStopDto]),
    __metadata("design:returntype", Promise)
], DriverController.prototype, "completeStop", null);
__decorate([
    (0, common_1.Get)('wallet'),
    (0, swagger_1.ApiOperation)({ summary: 'Get driver wallet transactions for month (YYYY-MM)' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('month')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DriverController.prototype, "getWallet", null);
__decorate([
    (0, common_1.Post)('trips/:tripId/select-vehicle'),
    (0, swagger_1.ApiOperation)({
        summary: 'Select vehicle for a trip (Driver only)',
    }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('tripId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, assign_vehicle_dto_1.AssignVehicleDto]),
    __metadata("design:returntype", Promise)
], DriverController.prototype, "selectVehicle", null);
__decorate([
    (0, common_1.Post)('location'),
    (0, swagger_1.ApiOperation)({ summary: 'Update driver location' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, update_location_dto_1.UpdateLocationDto]),
    __metadata("design:returntype", Promise)
], DriverController.prototype, "updateLocation", null);
__decorate([
    (0, common_1.Get)('location/me'),
    (0, swagger_1.ApiOperation)({ summary: 'Get my latest location' }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DriverController.prototype, "getMyLocation", null);
exports.DriverController = DriverController = __decorate([
    (0, swagger_1.ApiTags)('driver'),
    (0, common_1.Controller)('driver'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard, tenant_guard_1.TenantGuard, role_guard_1.RoleGuard),
    (0, role_guard_2.Roles)(client_1.Role.Driver),
    (0, swagger_1.ApiBearerAuth)('JWT-auth'),
    __metadata("design:paramtypes", [trip_service_1.TripService,
        prisma_service_1.PrismaService,
        location_service_1.LocationService,
        driver_mvp_service_1.DriverMvpService])
], DriverController);
//# sourceMappingURL=driver.controller.js.map
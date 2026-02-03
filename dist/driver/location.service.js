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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocationService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let LocationService = class LocationService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async upsertLocation(tenantId, driverUserId, dto) {
        const membership = await this.prisma.tenantMembership.findFirst({
            where: {
                tenantId,
                userId: driverUserId,
            },
        });
        if (!membership) {
            throw new common_1.NotFoundException('Driver not found or not a member of this tenant');
        }
        const location = await this.prisma.driverLocationLatest.upsert({
            where: {
                tenantId_driverUserId: {
                    tenantId,
                    driverUserId,
                },
            },
            update: {
                lat: dto.lat,
                lng: dto.lng,
                accuracy: dto.accuracy || null,
                heading: dto.heading || null,
                speed: dto.speed || null,
                capturedAt: new Date(),
            },
            create: {
                tenantId,
                driverUserId,
                lat: dto.lat,
                lng: dto.lng,
                accuracy: dto.accuracy || null,
                heading: dto.heading || null,
                speed: dto.speed || null,
                capturedAt: new Date(),
            },
        });
        return this.toLocationDto(location);
    }
    async getLatestLocation(tenantId, driverUserId) {
        const location = await this.prisma.driverLocationLatest.findUnique({
            where: {
                tenantId_driverUserId: {
                    tenantId,
                    driverUserId,
                },
            },
        });
        if (!location) {
            return null;
        }
        return this.toLocationDto(location);
    }
    async getAllDriverLocations(tenantId) {
        const locations = await this.prisma.driverLocationLatest.findMany({
            where: { tenantId },
            include: {},
            orderBy: {
                updatedAt: 'desc',
            },
        });
        const locationsWithUsers = await Promise.all(locations.map(async (location) => {
            const membership = await this.prisma.tenantMembership.findFirst({
                where: {
                    tenantId,
                    userId: location.driverUserId,
                },
                include: {
                    user: true,
                },
            });
            return {
                ...location,
                driverEmail: membership?.user.email || '',
                driverName: membership?.user.name || null,
            };
        }));
        return locationsWithUsers.map((loc) => this.toDriverLocationDto(loc));
    }
    toLocationDto(location) {
        return {
            driverUserId: location.driverUserId,
            lat: location.lat,
            lng: location.lng,
            accuracy: location.accuracy,
            heading: location.heading,
            speed: location.speed,
            capturedAt: location.capturedAt,
            updatedAt: location.updatedAt,
        };
    }
    toDriverLocationDto(location) {
        return {
            driverUserId: location.driverUserId,
            driverEmail: location.driverEmail,
            driverName: location.driverName,
            lat: location.lat,
            lng: location.lng,
            accuracy: location.accuracy,
            heading: location.heading,
            speed: location.speed,
            capturedAt: location.capturedAt,
            updatedAt: location.updatedAt,
        };
    }
};
exports.LocationService = LocationService;
exports.LocationService = LocationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], LocationService);
//# sourceMappingURL=location.service.js.map
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
exports.TripService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const client_1 = require("@prisma/client");
const event_log_service_1 = require("./event-log.service");
const client_2 = require("@prisma/client");
let TripService = class TripService {
    constructor(prisma, eventLogService) {
        this.prisma = prisma;
        this.eventLogService = eventLogService;
    }
    async createTrip(tenantId, dto) {
        const normalizedStops = dto.stops
            .map((stop, index) => ({
            ...stop,
            sequence: stop.sequence || index + 1,
        }))
            .sort((a, b) => a.sequence - b.sequence);
        const sequences = normalizedStops.map((s) => s.sequence);
        if (sequences[0] !== 1) {
            throw new common_1.BadRequestException('Stop sequence must start from 1');
        }
        if (new Set(sequences).size !== sequences.length) {
            throw new common_1.BadRequestException('Stop sequences must be unique');
        }
        const result = await this.prisma.$transaction(async (tx) => {
            const trip = await tx.trip.create({
                data: {
                    tenantId,
                    status: client_1.TripStatus.Draft,
                    plannedStartAt: dto.plannedStartAt
                        ? new Date(dto.plannedStartAt)
                        : null,
                    plannedEndAt: dto.plannedEndAt ? new Date(dto.plannedEndAt) : null,
                },
            });
            const stops = await Promise.all(normalizedStops.map((stopDto) => tx.stop.create({
                data: {
                    tenantId,
                    tripId: trip.id,
                    sequence: stopDto.sequence,
                    type: stopDto.type,
                    addressLine1: stopDto.addressLine1,
                    addressLine2: stopDto.addressLine2 || null,
                    city: stopDto.city,
                    postalCode: stopDto.postalCode,
                    country: stopDto.country,
                    plannedAt: stopDto.plannedAt ? new Date(stopDto.plannedAt) : null,
                    transportOrderId: stopDto.transportOrderId || null,
                },
            })));
            return { trip, stops };
        });
        await this.eventLogService.logEvent(tenantId, 'Trip', result.trip.id, 'TRIP_CREATED', {
            plannedStartAt: result.trip.plannedStartAt,
            plannedEndAt: result.trip.plannedEndAt,
        });
        for (const stop of result.stops) {
            await this.eventLogService.logEvent(tenantId, 'Stop', stop.id, 'STOP_CREATED', {
                sequence: stop.sequence,
                type: stop.type,
                tripId: result.trip.id,
            });
        }
        return this.toDto(result.trip, result.stops.map((stop) => ({
            ...stop,
            pod: stop.pods?.[0] || null,
        })));
    }
    async listTrips(tenantId, cursor, limit = 20) {
        const take = Math.min(limit, 100);
        const where = {
            tenantId,
            ...(cursor && {
                id: {
                    gt: cursor,
                },
            }),
        };
        const trips = await this.prisma.trip.findMany({
            where,
            take: take + 1,
            orderBy: {
                createdAt: 'desc',
            },
            include: {
                stops: {
                    orderBy: {
                        sequence: 'asc',
                    },
                    include: {
                        pods: {
                            take: 1,
                            orderBy: {
                                createdAt: 'desc',
                            },
                        },
                    },
                },
                assignedVehicle: true,
            },
        });
        const hasMore = trips.length > take;
        const result = hasMore ? trips.slice(0, take) : trips;
        const nextCursor = hasMore ? result[result.length - 1].id : undefined;
        const tripsWithDetails = await Promise.all(result.map((trip) => this.toDto(trip, trip.stops.map((stop) => ({
            ...stop,
            pod: stop.pods[0] || null,
        })))));
        return {
            trips: tripsWithDetails,
            nextCursor,
        };
    }
    async getTripById(tenantId, id) {
        const trip = await this.prisma.trip.findFirst({
            where: {
                id,
                tenantId,
            },
            include: {
                stops: {
                    orderBy: {
                        sequence: 'asc',
                    },
                    include: {
                        pods: {
                            take: 1,
                            orderBy: {
                                createdAt: 'desc',
                            },
                        },
                    },
                },
                assignedVehicle: true,
            },
        });
        if (!trip) {
            return null;
        }
        return this.toDto(trip, trip.stops.map((stop) => ({
            ...stop,
            pod: stop.pods[0] || null,
        })));
    }
    async toDto(trip, stops) {
        let assignedDriver = null;
        if (trip.assignedDriverId) {
            const membership = await this.prisma.tenantMembership.findFirst({
                where: {
                    tenantId: trip.tenantId,
                    userId: trip.assignedDriverId,
                    status: client_2.MembershipStatus.Active,
                },
                include: {
                    user: true,
                },
            });
            if (membership) {
                assignedDriver = {
                    id: membership.user.id,
                    email: membership.user.email,
                    name: membership.user.name,
                    phone: membership.user.phone,
                };
            }
        }
        let assignedVehicle = null;
        if (trip.assignedVehicle) {
            assignedVehicle = {
                id: trip.assignedVehicle.id,
                vehicleNumber: trip.assignedVehicle.vehicleNumber,
                type: trip.assignedVehicle.type,
            };
        }
        return {
            id: trip.id,
            status: trip.status,
            plannedStartAt: trip.plannedStartAt,
            plannedEndAt: trip.plannedEndAt,
            assignedDriverId: trip.assignedDriverId,
            assignedVehicleId: trip.assignedVehicleId,
            assignedDriver,
            assignedVehicle,
            createdAt: trip.createdAt,
            updatedAt: trip.updatedAt,
            stops: stops.map((stop) => this.stopToDto(stop)),
        };
    }
    stopToDto(stop) {
        return {
            id: stop.id,
            sequence: stop.sequence,
            type: stop.type,
            addressLine1: stop.addressLine1,
            addressLine2: stop.addressLine2,
            city: stop.city,
            postalCode: stop.postalCode,
            country: stop.country,
            plannedAt: stop.plannedAt,
            transportOrderId: stop.transportOrderId,
            createdAt: stop.createdAt,
            updatedAt: stop.updatedAt,
            pod: stop.pod ? this.podToDto(stop.pod) : null,
        };
    }
    podToDto(pod) {
        return {
            id: pod.id,
            status: pod.status,
            signedBy: pod.signedBy,
            signedAt: pod.signedAt,
            photoUrl: pod.photoUrl,
            createdAt: pod.createdAt,
            updatedAt: pod.updatedAt,
        };
    }
    async transitionStatus(tenantId, tripId, newStatus) {
        const statusMap = {
            Planned: client_1.TripStatus.Planned,
            Dispatched: client_1.TripStatus.Dispatched,
            InTransit: client_1.TripStatus.InTransit,
            Delivered: client_1.TripStatus.Delivered,
            Closed: client_1.TripStatus.Closed,
            Cancelled: client_1.TripStatus.Cancelled,
        };
        const targetStatus = statusMap[newStatus];
        if (!targetStatus) {
            throw new common_1.BadRequestException(`Invalid status transition: ${newStatus}`);
        }
        const trip = await this.prisma.trip.findFirst({
            where: {
                id: tripId,
                tenantId,
            },
            include: {
                stops: {
                    orderBy: {
                        sequence: 'asc',
                    },
                    include: {
                        pods: {
                            take: 1,
                            orderBy: {
                                createdAt: 'desc',
                            },
                        },
                    },
                },
            },
        });
        if (!trip) {
            throw new common_1.NotFoundException('Trip not found');
        }
        const validTransitions = {
            [client_1.TripStatus.Draft]: [client_1.TripStatus.Planned, client_1.TripStatus.Cancelled],
            [client_1.TripStatus.Planned]: [client_1.TripStatus.Dispatched, client_1.TripStatus.Cancelled],
            [client_1.TripStatus.Dispatched]: [client_1.TripStatus.InTransit, client_1.TripStatus.Cancelled],
            [client_1.TripStatus.InTransit]: [client_1.TripStatus.Delivered, client_1.TripStatus.Cancelled],
            [client_1.TripStatus.Delivered]: [client_1.TripStatus.Closed],
            [client_1.TripStatus.Closed]: [],
            [client_1.TripStatus.Cancelled]: [],
        };
        const allowedStatuses = validTransitions[trip.status];
        if (!allowedStatuses.includes(targetStatus)) {
            throw new common_1.BadRequestException(`Cannot transition from ${trip.status} to ${targetStatus}`);
        }
        const updatedTrip = await this.prisma.trip.update({
            where: { id: tripId },
            data: { status: targetStatus },
            include: {
                stops: {
                    orderBy: {
                        sequence: 'asc',
                    },
                    include: {
                        pods: {
                            take: 1,
                            orderBy: {
                                createdAt: 'desc',
                            },
                        },
                    },
                },
            },
        });
        await this.eventLogService.logEvent(tenantId, 'Trip', tripId, `TRIP_${newStatus.toUpperCase()}`, {
            previousStatus: trip.status,
            newStatus: targetStatus,
        });
        return this.toDto(updatedTrip, updatedTrip.stops.map((stop) => ({
            ...stop,
            pod: stop.pods[0] || null,
        })));
    }
    async getTripEvents(tenantId, tripId) {
        const trip = await this.prisma.trip.findFirst({
            where: {
                id: tripId,
                tenantId,
            },
        });
        if (!trip) {
            throw new common_1.NotFoundException('Trip not found');
        }
        const events = await this.prisma.eventLog.findMany({
            where: {
                tenantId,
                entityType: 'Trip',
                entityId: tripId,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
        return {
            tripId,
            events: events.map((event) => ({
                id: event.id,
                eventType: event.eventType,
                payload: event.payload,
                createdAt: event.createdAt,
            })),
        };
    }
    async listTripsForDriver(tenantId, driverUserId, cursor, limit = 20) {
        const take = Math.min(limit, 100);
        const where = {
            tenantId,
            assignedDriverId: driverUserId,
            ...(cursor && {
                id: {
                    gt: cursor,
                },
            }),
        };
        const trips = await this.prisma.trip.findMany({
            where,
            take: take + 1,
            orderBy: {
                createdAt: 'desc',
            },
            include: {
                stops: {
                    orderBy: {
                        sequence: 'asc',
                    },
                    include: {
                        pods: {
                            take: 1,
                            orderBy: {
                                createdAt: 'desc',
                            },
                        },
                    },
                },
                assignedVehicle: true,
            },
        });
        const hasMore = trips.length > take;
        const result = hasMore ? trips.slice(0, take) : trips;
        const nextCursor = hasMore ? result[result.length - 1].id : undefined;
        const tripsWithDetails = await Promise.all(result.map((trip) => this.toDto(trip, trip.stops.map((stop) => ({
            ...stop,
            pod: stop.pods[0] || null,
        })))));
        return {
            trips: tripsWithDetails,
            nextCursor,
        };
    }
    async assignDriver(tenantId, tripId, driverUserId) {
        const trip = await this.prisma.trip.findFirst({
            where: {
                id: tripId,
                tenantId,
            },
        });
        if (!trip) {
            throw new common_1.NotFoundException('Trip not found');
        }
        const membership = await this.prisma.tenantMembership.findFirst({
            where: {
                tenantId,
                userId: driverUserId,
                role: client_2.Role.Driver,
                status: client_2.MembershipStatus.Active,
            },
        });
        if (!membership) {
            throw new common_1.NotFoundException('Driver not found or not active in this tenant');
        }
        const updatedTrip = await this.prisma.trip.update({
            where: { id: tripId },
            data: { assignedDriverId: driverUserId },
            include: {
                stops: {
                    orderBy: {
                        sequence: 'asc',
                    },
                    include: {
                        pods: {
                            take: 1,
                            orderBy: {
                                createdAt: 'desc',
                            },
                        },
                    },
                },
                assignedVehicle: true,
            },
        });
        await this.eventLogService.logEvent(tenantId, 'Trip', tripId, 'DRIVER_ASSIGNED', {
            driverUserId,
        });
        return this.toDto(updatedTrip, updatedTrip.stops.map((stop) => ({
            ...stop,
            pod: stop.pods[0] || null,
        })));
    }
    async assignVehicle(tenantId, tripId, dto) {
        const trip = await this.prisma.trip.findFirst({
            where: {
                id: tripId,
                tenantId,
            },
        });
        if (!trip) {
            throw new common_1.NotFoundException('Trip not found');
        }
        let vehicle;
        if (dto.vehicleId) {
            vehicle = await this.prisma.vehicle.findFirst({
                where: {
                    id: dto.vehicleId,
                    tenantId,
                },
            });
        }
        else if (dto.vehicleNumber) {
            vehicle = await this.prisma.vehicle.findUnique({
                where: {
                    tenantId_vehicleNumber: {
                        tenantId,
                        vehicleNumber: dto.vehicleNumber,
                    },
                },
            });
        }
        if (!vehicle) {
            throw new common_1.NotFoundException('Vehicle not found in this tenant');
        }
        const updatedTrip = await this.prisma.trip.update({
            where: { id: tripId },
            data: { assignedVehicleId: vehicle.id },
            include: {
                stops: {
                    orderBy: {
                        sequence: 'asc',
                    },
                    include: {
                        pods: {
                            take: 1,
                            orderBy: {
                                createdAt: 'desc',
                            },
                        },
                    },
                },
                assignedVehicle: true,
            },
        });
        await this.eventLogService.logEvent(tenantId, 'Trip', tripId, 'VEHICLE_ASSIGNED', {
            vehicleId: vehicle.id,
            vehicleNumber: vehicle.vehicleNumber,
        });
        return this.toDto(updatedTrip, updatedTrip.stops.map((stop) => ({
            ...stop,
            pod: stop.pods[0] || null,
        })));
    }
};
exports.TripService = TripService;
exports.TripService = TripService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_log_service_1.EventLogService])
], TripService);
//# sourceMappingURL=trip.service.js.map
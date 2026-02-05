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
exports.DriverMvpService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const event_log_service_1 = require("../transport/event-log.service");
const client_1 = require("@prisma/client");
let DriverMvpService = class DriverMvpService {
    constructor(prisma, eventLogService) {
        this.prisma = prisma;
        this.eventLogService = eventLogService;
    }
    async getTripsByDate(tenantId, driverUserId, date) {
        const dayStart = new Date(date);
        dayStart.setUTCHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
        const trips = await this.prisma.trip.findMany({
            where: {
                tenantId,
                assignedDriverUserId: driverUserId,
                plannedStartAt: {
                    gte: dayStart,
                    lt: dayEnd,
                },
            },
            orderBy: { plannedStartAt: 'asc' },
            include: {
                stops: {
                    orderBy: { sequence: 'asc' },
                    include: {
                        transportOrder: true,
                        podPhotoDocuments: true,
                        pods: { take: 1, orderBy: { createdAt: 'desc' } },
                    },
                },
                vehicles: true,
            },
        });
        const result = [];
        for (const trip of trips) {
            const lockState = this.computeLockState(trip.stops, trip.status);
            result.push({
                id: trip.id,
                status: trip.status,
                plannedStartAt: trip.plannedStartAt,
                plannedEndAt: trip.plannedEndAt,
                assignedDriverId: trip.assignedDriverUserId,
                assignedVehicleId: trip.vehicleId,
                trailerNo: trip.acceptedTrailerNo ?? trip.acceptedVehicleNo ?? null,
                startedAt: trip.startedAt,
                closedAt: trip.closedAt,
                stops: trip.stops.map((s) => this.toDriverStopDto(s)),
                lockState,
                createdAt: trip.createdAt,
                updatedAt: trip.updatedAt,
            });
        }
        return { trips: result };
    }
    computeLockState(stops, tripStatus) {
        const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
        const completedCount = sorted.filter((s) => s.status === client_1.StopStatus.Completed).length;
        const allStopsCompleted = sorted.length > 0 && completedCount === sorted.length;
        const nextStop = sorted.find((s) => s.status !== client_1.StopStatus.Completed);
        const canStartStopId = nextStop?.status === client_1.StopStatus.Pending ? nextStop.id : null;
        const canStartTrip = tripStatus === client_1.TripStatus.Dispatched &&
            sorted.length > 0 &&
            sorted.every((s) => s.status === client_1.StopStatus.Pending);
        return {
            canStartTrip,
            canStartStopId,
            nextStopSequence: nextStop?.sequence ?? 0,
            allStopsCompleted,
        };
    }
    toDriverStopDto(stop) {
        let deliveryOrder = null;
        if (stop.transportOrder) {
            deliveryOrder = {
                id: stop.transportOrder.id,
                customerRef: stop.transportOrder.customerRef,
                status: stop.transportOrder.status,
            };
        }
        return {
            id: stop.id,
            sequence: stop.sequence,
            type: stop.type,
            status: stop.status,
            addressLine1: stop.addressLine1,
            addressLine2: stop.addressLine2,
            city: stop.city,
            postalCode: stop.postalCode,
            country: stop.country,
            plannedAt: stop.plannedAt,
            startedAt: stop.startedAt,
            completedAt: stop.completedAt,
            transportOrderId: stop.transportOrderId,
            deliveryOrder,
            podPhotoKeys: stop.podPhotoDocuments?.map((p) => p.photoKey) ?? [],
            createdAt: stop.createdAt,
            updatedAt: stop.updatedAt,
        };
    }
    async acceptTrip(tenantId, driverUserId, tripId, dto) {
        const trip = await this.prisma.trip.findFirst({
            where: { id: tripId, tenantId, assignedDriverUserId: driverUserId },
            include: {
                stops: {
                    orderBy: { sequence: 'asc' },
                    include: {
                        transportOrder: true,
                        podPhotoDocuments: true,
                    },
                },
            },
        });
        if (!trip) {
            throw new common_1.NotFoundException('Trip not found or not assigned to you');
        }
        if (trip.status !== client_1.TripStatus.Dispatched && trip.status !== client_1.TripStatus.Planned) {
            throw new common_1.BadRequestException(`Trip cannot be accepted in status ${trip.status}`);
        }
        let vehicleId = trip.vehicleId;
        if (dto.vehicleNo) {
            const vehicle = await this.prisma.vehicle.findFirst({
                where: {
                    tenantId,
                    vehicleNumber: dto.vehicleNo,
                },
            });
            if (!vehicle) {
                throw new common_1.NotFoundException('Vehicle not found');
            }
            vehicleId = vehicle.id;
        }
        const updated = await this.prisma.trip.update({
            where: { id: tripId },
            data: {
                status: client_1.TripStatus.Dispatched,
                vehicleId: vehicleId ?? undefined,
                acceptedVehicleNo: dto.vehicleNo ?? trip.acceptedVehicleNo ?? undefined,
                acceptedTrailerNo: dto.trailerNo ?? trip.acceptedTrailerNo ?? undefined,
            },
            include: {
                stops: {
                    orderBy: { sequence: 'asc' },
                    include: {
                        transportOrder: true,
                        podPhotoDocuments: true,
                    },
                },
            },
        });
        await this.eventLogService.logEvent(tenantId, 'Trip', tripId, 'TRIP_ACCEPTED', {
            vehicleNo: dto.vehicleNo,
            trailerNo: dto.trailerNo,
            vehicleId: updated.vehicleId,
        });
        const lockState = this.computeLockState(updated.stops, updated.status);
        return {
            id: updated.id,
            status: updated.status,
            plannedStartAt: updated.plannedStartAt,
            plannedEndAt: updated.plannedEndAt,
            assignedDriverId: updated.assignedDriverUserId,
            assignedVehicleId: updated.vehicleId,
            trailerNo: updated.acceptedTrailerNo ?? updated.acceptedVehicleNo ?? null,
            startedAt: updated.startedAt,
            closedAt: updated.closedAt,
            stops: updated.stops.map((s) => this.toDriverStopDto(s)),
            lockState,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
        };
    }
    async startTrip(tenantId, driverUserId, tripId) {
        const trip = await this.prisma.trip.findFirst({
            where: { id: tripId, tenantId, assignedDriverUserId: driverUserId },
            include: {
                stops: { orderBy: { sequence: 'asc' }, include: { transportOrder: true, podPhotoDocuments: true } },
            },
        });
        if (!trip) {
            throw new common_1.NotFoundException('Trip not found or not assigned to you');
        }
        if (trip.status !== client_1.TripStatus.Dispatched) {
            throw new common_1.BadRequestException(`Trip can only be started when status is Dispatched (current: ${trip.status})`);
        }
        const allPending = trip.stops.every((s) => s.status === client_1.StopStatus.Pending);
        if (!allPending) {
            throw new common_1.BadRequestException('All stops must be Pending to start trip');
        }
        const updated = await this.prisma.trip.update({
            where: { id: tripId },
            data: { status: client_1.TripStatus.InTransit, startedAt: new Date() },
            include: {
                stops: {
                    orderBy: { sequence: 'asc' },
                    include: { transportOrder: true, podPhotoDocuments: true },
                },
            },
        });
        await this.eventLogService.logEvent(tenantId, 'Trip', tripId, 'TRIP_STARTED', {});
        const lockState = this.computeLockState(updated.stops, updated.status);
        return {
            id: updated.id,
            status: updated.status,
            plannedStartAt: updated.plannedStartAt,
            plannedEndAt: updated.plannedEndAt,
            assignedDriverId: updated.assignedDriverUserId,
            assignedVehicleId: updated.vehicleId,
            trailerNo: updated.acceptedTrailerNo ?? updated.acceptedVehicleNo ?? null,
            startedAt: updated.startedAt,
            closedAt: updated.closedAt,
            stops: updated.stops.map((s) => this.toDriverStopDto(s)),
            lockState,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
        };
    }
    async startStop(tenantId, driverUserId, stopId) {
        const stop = await this.prisma.stop.findFirst({
            where: { id: stopId, tenantId },
            include: {
                trip: true,
                transportOrder: true,
                podPhotoDocuments: true,
            },
        });
        if (!stop) {
            throw new common_1.NotFoundException('Stop not found');
        }
        if (stop.trip.assignedDriverUserId !== driverUserId) {
            throw new common_1.ForbiddenException('Stop is not on a trip assigned to you');
        }
        if (stop.status !== client_1.StopStatus.Pending) {
            throw new common_1.BadRequestException(`Stop is not Pending (current: ${stop.status})`);
        }
        const prevStops = await this.prisma.stop.findMany({
            where: { tripId: stop.tripId, tenantId, sequence: { lt: stop.sequence } },
            orderBy: { sequence: 'desc' },
            take: 1,
        });
        if (prevStops.length > 0 && prevStops[0].status !== client_1.StopStatus.Completed) {
            throw new common_1.BadRequestException(`Cannot start stop ${stop.sequence} until stop ${prevStops[0].sequence} is completed`);
        }
        const updated = await this.prisma.stop.update({
            where: { id: stopId },
            data: { status: client_1.StopStatus.InProgress, startedAt: new Date() },
            include: { transportOrder: true, podPhotoDocuments: true },
        });
        await this.eventLogService.logEvent(tenantId, 'Stop', stopId, 'STOP_STARTED', {});
        return this.toDriverStopDto(updated);
    }
    async completeStop(tenantId, driverUserId, stopId, dto) {
        if (!dto.podPhotoKeys?.length) {
            throw new common_1.BadRequestException('At least one POD photo key is required');
        }
        const stop = await this.prisma.stop.findFirst({
            where: { id: stopId, tenantId },
            include: {
                trip: true,
                transportOrder: true,
                podPhotoDocuments: true,
            },
        });
        if (!stop) {
            throw new common_1.NotFoundException('Stop not found');
        }
        if (stop.trip.assignedDriverUserId !== driverUserId) {
            throw new common_1.ForbiddenException('Stop is not on a trip assigned to you');
        }
        if (stop.status === client_1.StopStatus.Completed) {
            throw new common_1.BadRequestException('Stop is already completed');
        }
        const maxSequence = await this.prisma.stop.aggregate({
            where: { tripId: stop.tripId },
            _max: { sequence: true },
        });
        const isFinalStop = maxSequence._max.sequence === stop.sequence;
        const updated = await this.prisma.$transaction(async (tx) => {
            const updatedStop = await tx.stop.update({
                where: { id: stopId },
                data: {
                    status: client_1.StopStatus.Completed,
                    completedAt: new Date(),
                },
                include: { transportOrder: true },
            });
            await tx.podPhotoDocument.deleteMany({ where: { stopId } });
            await tx.podPhotoDocument.createMany({
                data: dto.podPhotoKeys.map((photoKey) => ({
                    tenantId,
                    stopId,
                    photoKey,
                })),
            });
            if (updatedStop.transportOrderId) {
                await tx.transportOrder.update({
                    where: { id: updatedStop.transportOrderId },
                    data: { status: client_1.OrderStatus.Delivered },
                });
                if (updatedStop.type === client_1.StopType.DELIVERY) {
                    await tx.inventory_units.updateMany({
                        where: {
                            tenantId,
                            transportOrderId: updatedStop.transportOrderId,
                            status: { in: [client_1.InventoryUnitStatus.InTransit, client_1.InventoryUnitStatus.Reserved] },
                        },
                        data: { status: client_1.InventoryUnitStatus.Delivered },
                    });
                }
            }
            if (isFinalStop) {
                await tx.trip.update({
                    where: { id: stop.tripId },
                    data: {
                        status: client_1.TripStatus.Delivered,
                        closedAt: new Date(),
                    },
                });
                const driver = await tx.drivers.findFirst({
                    where: { tenantId, userId: driverUserId },
                });
                if (driver) {
                    await tx.driverWalletTransaction.create({
                        data: {
                            tenantId,
                            driverId: driver.id,
                            tripId: stop.tripId,
                            amountCents: 0,
                            currency: 'SGD',
                            type: 'TripCompleted',
                            description: `Trip ${stop.tripId} completed`,
                        },
                    });
                }
            }
            return tx.stop.findUnique({
                where: { id: stopId },
                include: { transportOrder: true, podPhotoDocuments: true },
            });
        });
        await this.eventLogService.logEvent(tenantId, 'Stop', stopId, 'STOP_COMPLETED', {
            podPhotoKeys: dto.podPhotoKeys,
            isFinalStop,
        });
        if (isFinalStop) {
            await this.eventLogService.logEvent(tenantId, 'Trip', stop.tripId, 'TRIP_DELIVERED', {});
        }
        return this.toDriverStopDto(updated);
    }
    async getWallet(tenantId, driverUserId, month) {
        const [y, m] = month.split('-').map(Number);
        if (!y || !m || m < 1 || m > 12) {
            throw new common_1.BadRequestException('Invalid month format; use YYYY-MM');
        }
        const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
        const end = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
        const driver = await this.prisma.drivers.findFirst({
            where: { tenantId, userId: driverUserId },
        });
        if (!driver) {
            return {
                month,
                transactions: [],
                totalCents: 0,
            };
        }
        const transactions = await this.prisma.driverWalletTransaction.findMany({
            where: {
                tenantId,
                driverId: driver.id,
                createdAt: { gte: start, lt: end },
            },
            orderBy: { createdAt: 'desc' },
        });
        const totalCents = transactions.reduce((sum, t) => sum + t.amountCents, 0);
        return {
            month,
            transactions: transactions.map((t) => ({
                id: t.id,
                tripId: t.tripId,
                amountCents: t.amountCents,
                currency: t.currency,
                type: t.type,
                description: t.description,
                createdAt: t.createdAt,
            })),
            totalCents,
        };
    }
};
exports.DriverMvpService = DriverMvpService;
exports.DriverMvpService = DriverMvpService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_log_service_1.EventLogService])
], DriverMvpService);
//# sourceMappingURL=driver-mvp.service.js.map
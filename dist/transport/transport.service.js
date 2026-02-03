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
exports.TransportService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const client_1 = require("@prisma/client");
const event_log_service_1 = require("./event-log.service");
let TransportService = class TransportService {
    constructor(prisma, eventLogService) {
        this.prisma = prisma;
        this.eventLogService = eventLogService;
    }
    async createOrder(tenantId, dto) {
        const order = await this.prisma.transportOrder.create({
            data: {
                tenantId,
                customerRef: dto.customerRef,
                status: client_1.OrderStatus.Draft,
                pickupWindowStart: dto.pickupWindowStart
                    ? new Date(dto.pickupWindowStart)
                    : null,
                pickupWindowEnd: dto.pickupWindowEnd
                    ? new Date(dto.pickupWindowEnd)
                    : null,
                deliveryWindowStart: dto.deliveryWindowStart
                    ? new Date(dto.deliveryWindowStart)
                    : null,
                deliveryWindowEnd: dto.deliveryWindowEnd
                    ? new Date(dto.deliveryWindowEnd)
                    : null,
                notes: dto.notes,
            },
        });
        return this.toDto(order);
    }
    async listOrders(tenantId, cursor, limit = 20) {
        const take = Math.min(limit, 100);
        const where = {
            tenantId,
            ...(cursor && {
                id: {
                    gt: cursor,
                },
            }),
        };
        const orders = await this.prisma.transportOrder.findMany({
            where,
            take: take + 1,
            orderBy: {
                createdAt: 'desc',
            },
        });
        const hasMore = orders.length > take;
        const result = hasMore ? orders.slice(0, take) : orders;
        const nextCursor = hasMore ? result[result.length - 1].id : undefined;
        return {
            orders: result.map((order) => this.toDto(order)),
            nextCursor,
        };
    }
    async getOrderById(tenantId, id) {
        const order = await this.prisma.transportOrder.findFirst({
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
            },
        });
        if (!order) {
            return null;
        }
        return this.toDtoWithStops(order);
    }
    async planTripFromOrder(tenantId, orderId) {
        const result = await this.prisma.$transaction(async (tx) => {
            const order = await tx.transportOrder.findFirst({
                where: {
                    id: orderId,
                    tenantId,
                },
            });
            if (!order) {
                throw new common_1.NotFoundException('Order not found');
            }
            const trip = await tx.trip.create({
                data: {
                    tenantId,
                    status: client_1.TripStatus.Draft,
                    plannedStartAt: order.pickupWindowStart,
                    plannedEndAt: order.deliveryWindowEnd,
                },
            });
            const pickupStop = await tx.stop.create({
                data: {
                    tenantId,
                    tripId: trip.id,
                    sequence: 1,
                    type: client_1.StopType.PICKUP,
                    addressLine1: 'TBD',
                    addressLine2: null,
                    city: 'Singapore',
                    postalCode: '000000',
                    country: 'SG',
                    plannedAt: order.pickupWindowStart,
                    transportOrderId: order.id,
                },
            });
            const deliveryStop = await tx.stop.create({
                data: {
                    tenantId,
                    tripId: trip.id,
                    sequence: 2,
                    type: client_1.StopType.DELIVERY,
                    addressLine1: 'TBD',
                    addressLine2: null,
                    city: 'Singapore',
                    postalCode: '000000',
                    country: 'SG',
                    plannedAt: order.deliveryWindowStart,
                    transportOrderId: order.id,
                },
            });
            await tx.eventLog.create({
                data: {
                    tenantId,
                    entityType: 'Trip',
                    entityId: trip.id,
                    eventType: 'TRIP_CREATED',
                    payload: {
                        orderId: order.id,
                        plannedStartAt: trip.plannedStartAt,
                        plannedEndAt: trip.plannedEndAt,
                    },
                },
            });
            await tx.eventLog.create({
                data: {
                    tenantId,
                    entityType: 'Stop',
                    entityId: pickupStop.id,
                    eventType: 'STOP_CREATED',
                    payload: {
                        orderId: order.id,
                        tripId: trip.id,
                        sequence: pickupStop.sequence,
                        type: pickupStop.type,
                    },
                },
            });
            await tx.eventLog.create({
                data: {
                    tenantId,
                    entityType: 'Stop',
                    entityId: deliveryStop.id,
                    eventType: 'STOP_CREATED',
                    payload: {
                        orderId: order.id,
                        tripId: trip.id,
                        sequence: deliveryStop.sequence,
                        type: deliveryStop.type,
                    },
                },
            });
            return { trip, stops: [pickupStop, deliveryStop] };
        });
        const tripWithStops = await this.prisma.trip.findUnique({
            where: { id: result.trip.id },
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
        if (!tripWithStops) {
            throw new common_1.NotFoundException('Trip not found after creation');
        }
        return this.tripToDto(tripWithStops, tripWithStops.stops.map((stop) => ({
            ...stop,
            pod: stop.pods[0] || null,
        })));
    }
    toDto(order) {
        return {
            id: order.id,
            customerRef: order.customerRef,
            status: order.status,
            pickupWindowStart: order.pickupWindowStart,
            pickupWindowEnd: order.pickupWindowEnd,
            deliveryWindowStart: order.deliveryWindowStart,
            deliveryWindowEnd: order.deliveryWindowEnd,
            notes: order.notes,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
        };
    }
    toDtoWithStops(order) {
        return {
            id: order.id,
            customerRef: order.customerRef,
            status: order.status,
            pickupWindowStart: order.pickupWindowStart,
            pickupWindowEnd: order.pickupWindowEnd,
            deliveryWindowStart: order.deliveryWindowStart,
            deliveryWindowEnd: order.deliveryWindowEnd,
            notes: order.notes,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
            stops: order.stops
                ? order.stops.map((stop) => ({
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
                    pod: stop.pods && stop.pods[0]
                        ? {
                            id: stop.pods[0].id,
                            status: stop.pods[0].status,
                            signedBy: stop.pods[0].signedBy,
                            signedAt: stop.pods[0].signedAt,
                            photoUrl: stop.pods[0].photoUrl,
                            createdAt: stop.pods[0].createdAt,
                            updatedAt: stop.pods[0].updatedAt,
                        }
                        : null,
                }))
                : undefined,
        };
    }
    tripToDto(trip, stops) {
        return {
            id: trip.id,
            status: trip.status,
            plannedStartAt: trip.plannedStartAt,
            plannedEndAt: trip.plannedEndAt,
            assignedDriverId: trip.assignedDriverId || null,
            assignedVehicleId: trip.assignedVehicleId || null,
            assignedDriver: null,
            assignedVehicle: trip.assignedVehicle
                ? {
                    id: trip.assignedVehicle.id,
                    vehicleNumber: trip.assignedVehicle.vehicleNumber,
                    type: trip.assignedVehicle.type,
                }
                : null,
            createdAt: trip.createdAt,
            updatedAt: trip.updatedAt,
            stops: stops.map((stop) => ({
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
                pod: stop.pod
                    ? {
                        id: stop.pod.id,
                        status: stop.pod.status,
                        signedBy: stop.pod.signedBy,
                        signedAt: stop.pod.signedAt,
                        photoUrl: stop.pod.photoUrl,
                        createdAt: stop.pod.createdAt,
                        updatedAt: stop.pod.updatedAt,
                    }
                    : null,
            })),
        };
    }
};
exports.TransportService = TransportService;
exports.TransportService = TransportService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_log_service_1.EventLogService])
], TransportService);
//# sourceMappingURL=transport.service.js.map
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
        const existing = await this.prisma.transportOrder.findFirst({
            where: { tenantId, orderRef: dto.orderRef },
        });
        if (existing) {
            throw new common_1.ConflictException({
                code: 'DUPLICATE_ORDER_REF',
                message: 'Order with this orderRef already exists for this tenant',
            });
        }
        const order = await this.prisma.$transaction(async (tx) => {
            const newOrder = await tx.transportOrder.create({
                data: {
                    tenantId,
                    orderRef: dto.orderRef,
                    customerName: dto.customerName,
                    customerRef: dto.customerName,
                    status: client_1.OrderStatus.Draft,
                },
            });
            for (let i = 0; i < dto.stops.length; i++) {
                const s = dto.stops[i];
                await tx.stop.create({
                    data: {
                        tenantId,
                        transportOrderId: newOrder.id,
                        sequence: i + 1,
                        type: s.type,
                        addressLine1: s.addressLine1,
                        addressLine2: s.addressLine2 ?? null,
                        city: s.city,
                        postalCode: s.postalCode,
                        country: s.country,
                        plannedAt: s.plannedAt ? new Date(s.plannedAt) : null,
                    },
                });
            }
            if (dto.items && dto.items.length > 0) {
                const aggregated = new Map();
                for (const it of dto.items) {
                    const existing = aggregated.get(it.inventoryItemId);
                    if (existing) {
                        existing.quantity += it.quantity;
                        if (it.batchId !== undefined && it.batchId !== existing.batchId)
                            existing.mixedBatches = true;
                    }
                    else {
                        aggregated.set(it.inventoryItemId, {
                            quantity: it.quantity,
                            batchId: it.batchId,
                            mixedBatches: false,
                        });
                    }
                }
                for (const [inventoryItemId, agg] of aggregated) {
                    const { quantity, batchId, mixedBatches } = agg;
                    const item = await tx.inventory_items.findFirst({
                        where: { id: inventoryItemId, tenantId },
                    });
                    if (!item) {
                        throw new common_1.BadRequestException(`Inventory item not found: ${inventoryItemId}`);
                    }
                    const unitWhere = {
                        tenantId,
                        inventoryItemId,
                        status: client_1.InventoryUnitStatus.Available,
                    };
                    if (batchId && !mixedBatches)
                        unitWhere.batchId = batchId;
                    const availableUnits = await tx.inventory_units.findMany({
                        where: unitWhere,
                        orderBy: { createdAt: 'asc' },
                        take: quantity,
                    });
                    if (availableUnits.length < quantity) {
                        throw new common_1.BadRequestException(`Not enough available units for item ${item.sku} (requested ${quantity}, available ${availableUnits.length})`);
                    }
                    const unitIds = availableUnits.map((u) => u.id);
                    await tx.inventory_units.updateMany({
                        where: { id: { in: unitIds } },
                        data: {
                            status: client_1.InventoryUnitStatus.Reserved,
                            transportOrderId: newOrder.id,
                        },
                    });
                    const effectiveBatchId = mixedBatches ? null : (batchId ?? null);
                    await tx.transport_order_items.upsert({
                        where: {
                            transportOrderId_inventoryItemId: {
                                transportOrderId: newOrder.id,
                                inventoryItemId,
                            },
                        },
                        create: {
                            tenantId,
                            transportOrderId: newOrder.id,
                            inventoryItemId,
                            batchId: effectiveBatchId,
                            qty: quantity,
                        },
                        update: {
                            qty: quantity,
                            batchId: effectiveBatchId,
                        },
                    });
                }
            }
            return tx.transportOrder.findUniqueOrThrow({
                where: { id: newOrder.id },
            });
        });
        return this.toDto(order);
    }
    async listOrders(tenantId, cursor, limit = 20) {
        console.log('[Transport] tenantId:', tenantId);
        if (!tenantId || tenantId === null || tenantId === undefined) {
            throw new common_1.BadRequestException('tenantId is required');
        }
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
            await tx.inventory_units.updateMany({
                where: {
                    tenantId,
                    transportOrderId: order.id,
                    status: client_1.InventoryUnitStatus.Reserved,
                },
                data: {
                    status: client_1.InventoryUnitStatus.InTransit,
                    tripId: trip.id,
                    stopId: deliveryStop.id,
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
                vehicles: true,
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
            orderRef: order.orderRef,
            customerRef: order.customerRef,
            customerName: order.customerName,
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
            orderRef: order.orderRef,
            customerRef: order.customerRef,
            customerName: order.customerName,
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
            assignedDriverId: trip.assignedDriverUserId ?? null,
            assignedVehicleId: trip.vehicleId ?? null,
            assignedDriver: null,
            assignedVehicle: trip.vehicles
                ? {
                    id: trip.vehicles.id,
                    vehicleNumber: trip.vehicles.vehicleNumber,
                    type: trip.vehicles.type ?? null,
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
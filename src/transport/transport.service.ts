import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  OrderStatus,
  TransportOrder,
  TripStatus,
  StopType,
  InventoryUnitStatus,
} from '@prisma/client';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderDto } from './dto/order.dto';
import { TripDto } from './dto/trip.dto';
import { EventLogService } from './event-log.service';

@Injectable()
export class TransportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogService: EventLogService,
  ) { }

  async createOrder(tenantId: string, dto: CreateOrderDto): Promise<OrderDto> {
    const existing = await this.prisma.transportOrder.findFirst({
      where: { tenantId, orderRef: dto.orderRef },
    });
    if (existing) {
      throw new ConflictException({
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

          // ✅ NEW
          customerContactNumber: dto.customerContactNumber ?? null,
          notes: dto.notes ?? null,

          status: OrderStatus.Draft,
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
        const aggregated = new Map<
          string,
          { quantity: number; batchId?: string | null; mixedBatches: boolean }
        >();
        for (const it of dto.items) {
          const existing = aggregated.get(it.inventoryItemId);
          if (existing) {
            existing.quantity += it.quantity;
            if (it.batchId !== undefined && it.batchId !== existing.batchId)
              existing.mixedBatches = true;
          } else {
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
            throw new BadRequestException(
              `Inventory item not found: ${inventoryItemId}`,
            );
          }

          const unitWhere: any = {
            tenantId,
            inventoryItemId,
            status: InventoryUnitStatus.Available,
          };
          if (batchId && !mixedBatches) unitWhere.batchId = batchId;

          const availableUnits = await tx.inventory_units.findMany({
            where: unitWhere,
            orderBy: { createdAt: 'asc' },
            take: quantity,
          });

          if (availableUnits.length < quantity) {
            throw new BadRequestException(
              `Not enough available units for item ${item.sku} (requested ${quantity}, available ${availableUnits.length})`,
            );
          }

          const unitIds = availableUnits.map((u) => u.id);
          await tx.inventory_units.updateMany({
            where: { id: { in: unitIds } },
            data: {
              status: InventoryUnitStatus.Reserved,
              transportOrderId: newOrder.id,
            },
          });

          const effectiveBatchId =
            mixedBatches ? null : (batchId ?? null);
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

  async listOrders(
    tenantId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{ orders: OrderDto[]; nextCursor?: string }> {
    // Temporary debug log to verify request flow
    console.log('[Transport] tenantId:', tenantId);

    // tenantId is REQUIRED - all roles must operate under a tenant
    if (!tenantId || tenantId === null || tenantId === undefined) {
      throw new BadRequestException('tenantId is required');
    }

    const take = Math.min(limit, 100); // Max 100 per page

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
      take: take + 1, // Fetch one extra to check if there's more
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

  async getOrderById(tenantId: string, id: string): Promise<OrderDto | null> {
    const order = await this.prisma.transportOrder.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        stops: {
          orderBy: { sequence: "asc" },
          include: {
            pods: {
              take: 1,
              orderBy: { createdAt: "desc" },
            },
          },
        },
    
        // ✅ ADD THIS
        transport_order_items: {
          include: {
            inventory_item: true,
            units: { include: { inventory_unit: true } },
          },
        },
      },
    });

    if (!order) {
      return null;
    }

    return this.toDtoWithStops(order);
  }

  async planTripFromOrder(
    tenantId: string,
    orderId: string,
  ): Promise<TripDto> {
    // Load order and create trip + stops + event logs in a single transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 1) Find TransportOrder by { id: orderId, tenantId } else 404
      const order = await tx.transportOrder.findFirst({
        where: {
          id: orderId,
          tenantId,
        },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      // 2) Create Trip
      const trip = await tx.trip.create({
        data: {
          tenantId,
          status: TripStatus.Draft,
          plannedStartAt: order.pickupWindowStart,
          plannedEndAt: order.deliveryWindowEnd,
        },
      });

      // 3) Create 2 Stops linked to the trip
      // a) Stop #1: sequence=1 type=PICKUP
      const pickupStop = await tx.stop.create({
        data: {
          tenantId,
          tripId: trip.id,
          sequence: 1,
          type: StopType.PICKUP,
          addressLine1: 'TBD',
          addressLine2: null,
          city: 'Singapore',
          postalCode: '000000',
          country: 'SG',
          plannedAt: order.pickupWindowStart,
          transportOrderId: order.id,
        },
      });

      // b) Stop #2: sequence=2 type=DELIVERY
      const deliveryStop = await tx.stop.create({
        data: {
          tenantId,
          tripId: trip.id,
          sequence: 2,
          type: StopType.DELIVERY,
          addressLine1: 'TBD',
          addressLine2: null,
          city: 'Singapore',
          postalCode: '000000',
          country: 'SG',
          plannedAt: order.deliveryWindowStart,
          transportOrderId: order.id,
        },
      });

      // 4) Create EventLog rows in transaction
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

      // Mark order's reserved inventory units as InTransit; link to trip and delivery stop
      await tx.inventory_units.updateMany({
        where: {
          tenantId,
          transportOrderId: order.id,
          status: InventoryUnitStatus.Reserved,
        },
        data: {
          status: InventoryUnitStatus.InTransit,
          tripId: trip.id,
          stopId: deliveryStop.id,
        },
      });

      return { trip, stops: [pickupStop, deliveryStop] };
    });

    // Fetch trip with stops and pods for response
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
      throw new NotFoundException('Trip not found after creation');
    }

    return this.tripToDto(
      tripWithStops,
      tripWithStops.stops.map((stop) => ({
        ...stop,
        pod: stop.pods[0] || null,
      })),
    );
  }
  private toDto(order: TransportOrder): OrderDto {
    return {
      id: order.id,
      orderRef: order.orderRef,
      customerRef: order.customerRef,
      customerName: order.customerName,

      // ✅ NEW
      customerContactNumber: (order as any).customerContactNumber ?? null,

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

  private toDtoWithStops(order: any): OrderDto {
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
      // ✅ NEW
      items: order.transport_order_items?.map((it: any) => ({
        id: it.id,
        inventoryItemId: it.inventoryItemId,
        batchId: it.batchId ?? null,
        qty: it.qty,
        sku: it.inventory_item?.sku ?? null,
        name: it.inventory_item?.name ?? null,
      })) ?? [],
      customerContactNumber: order.customerContactNumber ?? null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      stops: order.stops
        ? order.stops.map((stop: any) => ({
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

  private tripToDto(trip: any, stops: any[]): TripDto {
    return {
      id: trip.id,
      status: trip.status,
      plannedStartAt: trip.plannedStartAt,
      plannedEndAt: trip.plannedEndAt,
      assignedDriverId: trip.assignedDriverUserId ?? null,
      assignedVehicleId: trip.vehicleId ?? null,
      assignedDriver: null, // TransportService doesn't load driver/vehicle details
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
}

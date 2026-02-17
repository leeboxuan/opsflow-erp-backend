import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  OrderStatus,
  TransportOrder,
  TripStatus,
  StopType,
  InventoryUnitStatus,
} from "@prisma/client";
import { CreateOrderDto } from "./dto/create-order.dto";
import { OrderDto } from "./dto/order.dto";
import { TripDto } from "./dto/trip.dto";
import { EventLogService } from "./event-log.service";
import { UpdateOrderDto } from "./dto/update-order.dto";
import { ReplaceOrderItemsDto } from "./dto/replace-order-items.dto";

@Injectable()
export class TransportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogService: EventLogService,
  ) {}
  private async generateInternalRef(tenantId: string, hint?: string) {
    const yyyyMmDd = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const base = `DB-${yyyyMmDd}-`;

    const cleanHint = String(hint ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 3);

    // If hint too short, fall back to sequence
    if (cleanHint.length >= 3) {
      const candidate = `${base}${cleanHint}`;
      const exists = await this.prisma.transportOrder.findFirst({
        where: { tenantId, internalRef: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }

    const countToday = await this.prisma.transportOrder.count({
      where: { tenantId, internalRef: { startsWith: base } },
    });

    const seq = String(countToday + 1).padStart(3, "0");
    return `${base}${seq}`;
  }

  async createOrder(tenantId: string, dto: CreateOrderDto): Promise<OrderDto> {
    const existing = await this.prisma.transportOrder.findFirst({
      where: { tenantId, orderRef: dto.orderRef },
    });
    if (existing) {
      throw new ConflictException({
        code: "DUPLICATE_ORDER_REF",
        message: "Order with this orderRef already exists for this tenant",
      });
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const internalRef =
        dto.internalRef?.trim() ||
        (await this.generateInternalRef(tenantId, dto.orderRef));

      const newOrder = await tx.transportOrder.create({
        data: {
          tenantId,
          // client ref
          orderRef: dto.orderRef.trim(),
          // internal
          internalRef,

          customerName: dto.customerName,
          // keep legacy customerRef if you still use it anywhere
          customerRef: dto.customerName,

          customerContactNumber: dto.customerContactNumber ?? null,
          notes: dto.notes ?? null,
          status: OrderStatus.Draft,
          priceCents: dto.priceCents ?? null,
          currency: dto.currency ?? "SGD",
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
            orderBy: { createdAt: "asc" },
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

          const effectiveBatchId = mixedBatches ? null : (batchId ?? null);

          // Upsert the order item line
          const orderItem = await tx.transport_order_items.upsert({
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

          // ✅ Create unit links (so unitSkus can be returned)
          await tx.transport_order_item_units.createMany({
            data: unitIds.map((inventoryUnitId) => ({
              tenantId,
              transportOrderItemId: orderItem.id,
              inventoryUnitId,
            })),
            skipDuplicates: true,
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
    customerCompanyId?: string,
  ): Promise<{ orders: OrderDto[]; nextCursor?: string }> {
    // Temporary debug log to verify request flow
    console.log("[Transport] tenantId:", tenantId);

    // tenantId is REQUIRED - all roles must operate under a tenant
    if (!tenantId || tenantId === null || tenantId === undefined) {
      throw new BadRequestException("tenantId is required");
    }

    const take = Math.min(limit, 100); // Max 100 per page

    const where: any = { tenantId };
    if (customerCompanyId) {
      where.customerCompanyId = customerCompanyId;
    }

    const orders = await this.prisma.transportOrder.findMany({
      where,
      take: take + 1, // Fetch one extra to check if there's more
      orderBy: {
        createdAt: "desc",
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

  async getOrderById(
    tenantId: string,
    id: string,
    customerCompanyId?: string,
  ): Promise<OrderDto | null> {
    const where: any = { id, tenantId };

    if (customerCompanyId) where.customerCompanyId = customerCompanyId;

    const order = await this.prisma.transportOrder.findFirst({
      where,
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

  async planTripFromOrder(tenantId: string, orderId: string): Promise<TripDto> {
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
        throw new NotFoundException("Order not found");
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
          addressLine1: "TBD",
          addressLine2: null,
          city: "Singapore",
          postalCode: "000000",
          country: "SG",
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
          addressLine1: "TBD",
          addressLine2: null,
          city: "Singapore",
          postalCode: "000000",
          country: "SG",
          plannedAt: order.deliveryWindowStart,
          transportOrderId: order.id,
        },
      });

      // 4) Create EventLog rows in transaction
      await tx.eventLog.create({
        data: {
          tenantId,
          entityType: "Trip",
          entityId: trip.id,
          eventType: "TRIP_CREATED",
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
          entityType: "Stop",
          entityId: pickupStop.id,
          eventType: "STOP_CREATED",
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
          entityType: "Stop",
          entityId: deliveryStop.id,
          eventType: "STOP_CREATED",
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
            sequence: "asc",
          },
          include: {
            pods: {
              take: 1,
              orderBy: {
                createdAt: "desc",
              },
            },
          },
        },
        vehicles: true,
      },
    });

    if (!tripWithStops) {
      throw new NotFoundException("Trip not found after creation");
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
      internalRef: (order as any).internalRef ?? null,

      customerRef: order.customerRef,
      customerName: order.customerName,
      customerContactNumber: (order as any).customerContactNumber ?? null,

      status: order.status,
      pickupWindowStart: order.pickupWindowStart,
      pickupWindowEnd: order.pickupWindowEnd,
      deliveryWindowStart: order.deliveryWindowStart,
      deliveryWindowEnd: order.deliveryWindowEnd,
      notes: order.notes,

      doDocumentUrl: (order as any).doDocumentUrl ?? null,
      doSignatureUrl: (order as any).doSignatureUrl ?? null,
      doSignerName: (order as any).doSignerName ?? null,
      doSignedAt: (order as any).doSignedAt ?? null,
      doStatus: (order as any).doStatus ?? null,
      doVersion: (order as any).doVersion ?? null,

      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      priceCents: order.priceCents ?? null,
      currency: order.currency ?? "SGD",
      invoiceId: order.invoiceId ?? null,
    };
  }

  private toDtoWithStops(order: any): OrderDto {
    return {
      id: order.id,
      orderRef: order.orderRef,
      internalRef: order.internalRef ?? null,

      doDocumentUrl: order.doDocumentUrl ?? null,
      doSignatureUrl: order.doSignatureUrl ?? null,
      doSignerName: order.doSignerName ?? null,
      doSignedAt: order.doSignedAt ?? null,
      doStatus: order.doStatus ?? null,
      doVersion: order.doVersion ?? null,
      customerRef: order.customerRef,
      customerName: order.customerName,
      status: order.status,
      pickupWindowStart: order.pickupWindowStart,
      pickupWindowEnd: order.pickupWindowEnd,
      deliveryWindowStart: order.deliveryWindowStart,
      deliveryWindowEnd: order.deliveryWindowEnd,
      notes: order.notes,
      // ✅ NEW
      items:
        order.transport_order_items?.map((it: any) => ({
          id: it.id,
          inventoryItemId: it.inventoryItemId,
          batchId: it.batchId ?? null,
          qty: it.qty,
          sku: it.inventory_item?.sku ?? null,
          name: it.inventory_item?.name ?? null,
          unitSkus:
            it.units
              ?.map((u: any) => u.inventory_unit?.unitSku)
              .filter(Boolean) ?? [],
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
            pod:
              stop.pods && stop.pods[0]
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
      priceCents: order.priceCents ?? null,
      currency: order.currency ?? "SGD",
      invoiceId: order.invoiceId ?? null,

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

      // ✅ Trip-level location (not per stop)
      driverLocation: null,

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

  async updateOrder(
    tenantId: string,
    orderId: string,
    dto: UpdateOrderDto,
  ): Promise<OrderDto> {
    const order = await this.prisma.transportOrder.findFirst({
      where: { id: orderId, tenantId },
    });

    if (!order) throw new NotFoundException("Order not found");

    const updated = await this.prisma.transportOrder.update({
      where: { id: orderId },
      data: {
        status: dto.status ?? undefined,
        customerName: dto.customerName ?? undefined,
        customerContactNumber: dto.customerContactNumber ?? undefined,
        notes: dto.notes ?? undefined,
        priceCents: dto.priceCents ?? undefined,
        currency: dto.currency ?? undefined,
      },
    });

    return this.toDto(updated);
  }

  async updateOrderHeader(
    tenantId: string,
    orderId: string,
    dto: UpdateOrderDto,
  ): Promise<OrderDto> {
    const order = await this.prisma.transportOrder.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) throw new NotFoundException("Order not found");

    const nextStatus = (dto.status ?? order.status) as any;
    const prevStatus = order.status as any;

    const updated = await this.prisma.$transaction(async (tx) => {
      const o = await tx.transportOrder.update({
        where: { id: orderId },
        data: {
          status: dto.status ?? undefined,
          customerName: dto.customerName ?? undefined,
          customerContactNumber: dto.customerContactNumber ?? undefined,
          notes: dto.notes ?? undefined,
          priceCents: dto.priceCents ?? undefined,
          currency: dto.currency ?? undefined,
        },
      });

      // ✅ Sync unit statuses based on order status
      if (dto.status && dto.status !== prevStatus) {
        if (dto.status === "InTransit") {
          await tx.inventory_units.updateMany({
            where: { tenantId, transportOrderId: orderId },
            data: { status: "InTransit" as any },
          });
        }

        if (dto.status === "Delivered" || dto.status === "Closed") {
          await tx.inventory_units.updateMany({
            where: { tenantId, transportOrderId: orderId },
            data: { status: "Delivered" as any },
          });
        }

        if (dto.status === "Cancelled") {
          await tx.inventory_units.updateMany({
            where: { tenantId, transportOrderId: orderId },
            data: { status: "Available" as any, transportOrderId: null },
          });
        }
      }

      return o;
    });

    return this.toDto(updated);
  }

  async replaceOrderItems(
    tenantId: string,
    orderId: string,
    dto: ReplaceOrderItemsDto,
  ): Promise<OrderDto> {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.transportOrder.findFirst({
        where: { id: orderId, tenantId },
      });
      if (!order) throw new NotFoundException("Order not found");

      // Normalize: drop lines with qty=0
      const lines = (dto.items ?? []).filter((x) => (x.qty ?? 0) > 0);

      // Existing order items + their linked units
      const existing = await tx.transport_order_items.findMany({
        where: { tenantId, transportOrderId: orderId },
        include: { units: true },
      });

      const existingItemIds = new Set(existing.map((x) => x.id));

      // 1) Detach ALL existing unit links + unreserve units from this order
      // (we'll re-assign based on new payload)
      const existingLinked = await tx.transport_order_item_units.findMany({
        where: {
          tenantId,
          transportOrderItemId: { in: Array.from(existingItemIds) },
        },
        select: { inventoryUnitId: true },
      });

      const oldUnitIds = existingLinked.map((x) => x.inventoryUnitId);

      if (oldUnitIds.length > 0) {
        await tx.inventory_units.updateMany({
          where: {
            tenantId,
            id: { in: oldUnitIds },
            transportOrderId: orderId,
          },
          data: {
            status: InventoryUnitStatus.Available,
            transportOrderId: null,
          },
        });
      }

      await tx.transport_order_item_units.deleteMany({
        where: {
          tenantId,
          transportOrderItemId: { in: Array.from(existingItemIds) },
        },
      });

      // 2) Delete existing item lines (we'll recreate clean)
      await tx.transport_order_items.deleteMany({
        where: { tenantId, transportOrderId: orderId },
      });

      // 3) Recreate item lines + allocate units
      for (const line of lines) {
        const item = await tx.inventory_items.findFirst({
          where: { tenantId, id: line.inventoryItemId },
        });
        if (!item) {
          throw new BadRequestException(
            `Inventory item not found: ${line.inventoryItemId}`,
          );
        }

        // Create the order item line
        const orderItem = await tx.transport_order_items.create({
          data: {
            tenantId,
            transportOrderId: orderId,
            inventoryItemId: line.inventoryItemId,
            qty: line.qty,
            batchId: null,
          },
        });

        // Allocate units:
        // If unitSkus provided -> lock those exact units
        // Else -> auto allocate FIFO from Available
        let unitsToReserve: { id: string }[] = [];

        if (line.unitSkus && line.unitSkus.length > 0) {
          if (line.unitSkus.length !== line.qty) {
            throw new BadRequestException(
              `unitSkus length must equal qty for item ${item.sku} (qty ${line.qty}, unitSkus ${line.unitSkus.length})`,
            );
          }

          const found = await tx.inventory_units.findMany({
            where: {
              tenantId,
              unitSku: { in: line.unitSkus },
              inventoryItemId: line.inventoryItemId,
              status: InventoryUnitStatus.Available,
              transportOrderId: null,
            },
          });

          if (found.length !== line.unitSkus.length) {
            throw new BadRequestException(
              `Some unitSkus are unavailable or invalid for item ${item.sku}`,
            );
          }

          unitsToReserve = found.map((u) => ({ id: u.id }));
        } else {
          const found = await tx.inventory_units.findMany({
            where: {
              tenantId,
              inventoryItemId: line.inventoryItemId,
              status: InventoryUnitStatus.Available,
              transportOrderId: null,
            },
            orderBy: { createdAt: "asc" },
            take: line.qty,
          });

          if (found.length < line.qty) {
            throw new BadRequestException(
              `Not enough available units for item ${item.sku} (requested ${line.qty}, available ${found.length})`,
            );
          }

          unitsToReserve = found.map((u) => ({ id: u.id }));
        }

        const unitIds = unitsToReserve.map((u) => u.id);

        await tx.inventory_units.updateMany({
          where: { tenantId, id: { in: unitIds } },
          data: {
            status: InventoryUnitStatus.Reserved,
            transportOrderId: orderId,
          },
        });

        await tx.transport_order_item_units.createMany({
          data: unitIds.map((inventoryUnitId) => ({
            tenantId,
            transportOrderItemId: orderItem.id,
            inventoryUnitId,
          })),
        });
      }

      // Return updated order with stops + item unitSkus
      const full = await tx.transportOrder.findFirst({
        where: { id: orderId, tenantId },
        include: {
          stops: {
            orderBy: { sequence: "asc" },
            include: { pods: { take: 1, orderBy: { createdAt: "desc" } } },
          },
          transport_order_items: {
            include: {
              inventory_item: true,
              units: { include: { inventory_unit: true } },
            },
          },
        },
      });

      if (!full) throw new NotFoundException("Order not found after update");
      return this.toDtoWithStops(full);
    });
  }

  async deleteOrder(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true },
    });

    if (!order) throw new NotFoundException("Order not found");

    // Block delete if order is already in an active trip
    const locked = await this.prisma.tripStop.findFirst({
      where: {
        tenantId,
        orderId,
        trip: { status: { in: ["Dispatched", "InTransit"] } },
      },
      select: { id: true },
    });

    if (locked) throw new BadRequestException("Order is in an active trip");

    await this.prisma.$transaction([
      // If your schema names differ, adjust these two lines accordingly:
      this.prisma.orderItem.deleteMany({ where: { tenantId, orderId } }),
      this.prisma.tripStop.deleteMany({ where: { tenantId, orderId } }),
      this.prisma.order.delete({ where: { id: orderId } }),
    ]);

    return { ok: true };
  }

  async getOrderLive(tenantId: string, orderId: string) {
    const stop = await this.prisma.stop.findFirst({
      where: { tenantId, transportOrderId: orderId, tripId: { not: null } },
      select: { tripId: true },
    });

    if (!stop?.tripId) {
      return {
        orderId,
        tripId: null,
        driverUserId: null,
        lat: null,
        lng: null,
        capturedAt: null,
      };
    }

    const trip = await this.prisma.trip.findFirst({
      where: { tenantId, id: stop.tripId },
      select: { id: true, assignedDriverUserId: true },
    });

    const driverUserId = trip?.assignedDriverUserId ?? null;

    const loc = driverUserId
      ? await this.prisma.driver_location_latest.findFirst({
          where: { tenantId, driverUserId },
          select: { lat: true, lng: true, capturedAt: true },
        })
      : null;

    return {
      orderId,
      tripId: trip?.id ?? null,
      driverUserId,
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      capturedAt: loc?.capturedAt ?? null,
    };
  }

  async updateOrderDo(
    tenantId: string,
    orderId: string,
    dto: any,
  ): Promise<OrderDto> {
    const order = await this.prisma.transportOrder.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) throw new NotFoundException("Order not found");

    const updated = await this.prisma.transportOrder.update({
      where: { id: orderId },
      data: {
        doDocumentUrl: dto.doDocumentUrl ?? order.doDocumentUrl,
        doSignatureUrl: dto.doSignatureUrl ?? order.doSignatureUrl,
        doSignerName: dto.doSignerName ?? order.doSignerName,
        doSignedAt: dto.doSignedAt
          ? new Date(dto.doSignedAt)
          : order.doSignedAt,
        doStatus: dto.doStatus ?? order.doStatus,
        doVersion: { increment: 1 },
      },
      include: {
        stops: {
          orderBy: { sequence: "asc" },
          include: {
            pods: { take: 1, orderBy: { createdAt: "desc" } },
          },
        },
        transport_order_items: {
          include: {
            inventory_item: true,
            units: { include: { inventory_unit: true } },
          },
        },
      },
    });

    return this.toDtoWithStops(updated);
  }
}

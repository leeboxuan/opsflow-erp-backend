import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import {
  InventoryUnitStatus,
  OrderStatus,
  StopType,
  TransportOrder,
  TripStatus,
  Prisma,
} from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { EventLogService } from "./event-log.service";

import { CreateOrderDto } from "./dto/create-order.dto";
import { UpdateOrderDto } from "./dto/update-order.dto";
import { ReplaceOrderItemsDto } from "./dto/replace-order-items.dto";

import { OrderDto } from "./dto/order.dto";
import { TripDto } from "./dto/trip.dto";

type InternalRefCounterClient = {
  transport_internal_ref_counters: {
    upsert: (
      args: Parameters<
        PrismaService["transport_internal_ref_counters"]["upsert"]
      >[0],
    ) => Promise<{ nextSeq: number }>;
  };
};

export interface CreatedOrderSummary {
  id: string;
  internalRef: string;
  externalRef?: string;
}

export interface CreateOrdersBatchResult {
  createdCount: number;
  created: CreatedOrderSummary[];
}

// NOTE: If Prisma Client types lag behind schema edits, this preserves runtime value "Open"
// while still keeping the field typed as OrderStatus.
const ORDER_STATUS_OPEN = "Open" as any as OrderStatus;

@Injectable()
export class TransportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogService: EventLogService,
  ) {}

  /**
   * Allocate a contiguous block of internalRef values for a given tenant + (year, month)
   * using an atomic counter row (`transport_internal_ref_counters`).
   *
   * This uses a single `upsert` on the counter table and derives the start/end of the
   * allocated sequence block from the returned `nextSeq` value, ensuring uniqueness
   * even under high concurrency and without scanning the main orders table.
   */
  private async allocateInternalRefBlock(
    client: InternalRefCounterClient,
    tenantId: string,
    yyyy: number,
    mm: number,
    batchSize: number,
  ): Promise<string[]> {
    if (batchSize <= 0) {
      throw new Error("batchSize must be positive");
    }
    if (mm < 1 || mm > 12) throw new Error("Invalid month");

    const MM = String(mm).padStart(2, "0");
    const yyyymm = `${yyyy}-${MM}`;

    const row = await client.transport_internal_ref_counters.upsert({
      where: {
        tenantId_yyyymm: {
          tenantId,
          yyyymm,
        },
      },
      create: {
        tenantId,
        yyyymm,
        nextSeq: batchSize,
      },
      update: {
        nextSeq: { increment: batchSize },
      },
      select: {
        nextSeq: true,
      },
    });

    const endSeq = row.nextSeq;
    const startSeq = endSeq - batchSize + 1;

    const refs: string[] = [];
    for (let seq = startSeq; seq <= endSeq; seq++) {
      const ss = String(seq).padStart(2, "0");
      refs.push(`DB-${yyyy}-${MM}-${ss}-IMP`);
    }

    return refs;
  }

  async getNextInternalRef(tenantId: string, year?: number, month?: number) {
    const now = new Date();
    const yyyy = year ?? now.getUTCFullYear();
    const mm = month ?? now.getUTCMonth() + 1;

    const [internalRef] = await this.allocateInternalRefBlock(
      this.prisma as unknown as InternalRefCounterClient,
      tenantId,
      yyyy,
      mm,
      1,
    );
    return { internalRef };
  }

  private aggregateOrderItems(dto: CreateOrderDto) {
    const aggregated = new Map<
      string,
      { quantity: number; batchId?: string | null; mixedBatches: boolean }
    >();

    for (const it of dto.items ?? []) {
      const prev = aggregated.get(it.inventoryItemId);
      if (prev) {
        prev.quantity += it.quantity;
        if (it.batchId !== undefined && it.batchId !== prev.batchId) {
          prev.mixedBatches = true;
        }
      } else {
        aggregated.set(it.inventoryItemId, {
          quantity: it.quantity,
          batchId: it.batchId,
          mixedBatches: false,
        });
      }
    }

    const aggregatedEntries = Array.from(aggregated.entries());
    const inventoryItemIds = aggregatedEntries.map(([id]) => id);

    return { aggregatedEntries, inventoryItemIds };
  }

  private async createOneOrderInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    dto: CreateOrderDto,
    internalRef: string,
  ): Promise<TransportOrder> {
    const { aggregatedEntries, inventoryItemIds } = this.aggregateOrderItems(dto);

    if (inventoryItemIds.length > 0) {
      const found = await tx.inventory_items.findMany({
        where: { tenantId, id: { in: inventoryItemIds } },
        select: { id: true },
      });
      const foundSet = new Set(found.map((x) => x.id));
      const missing = inventoryItemIds.filter((id) => !foundSet.has(id));
      if (missing.length) {
        throw new BadRequestException(`Inventory item not found: ${missing[0]}`);
      }
    }

    const newOrder = await tx.transportOrder.create({
      data: {
        tenantId,
        orderRef: dto.orderRef.trim(),
        internalRef,
        customerName: dto.customerName,
        customerRef: dto.customerName, // legacy
        customerContactNumber: dto.customerContactNumber ?? null,
        notes: dto.notes ?? null,
        status: ORDER_STATUS_OPEN,
        priceCents: dto.priceCents ?? null,
        currency: dto.currency ?? "SGD",
      },
      select: { id: true },
    });

    if (dto.stops?.length) {
      await tx.stop.createMany({
        data: dto.stops.map((s, idx) => ({
          tenantId,
          transportOrderId: newOrder.id,
          sequence: idx + 1,
          type: s.type,
          addressLine1: s.addressLine1,
          addressLine2: s.addressLine2 ?? null,
          city: s.city,
          postalCode: s.postalCode,
          country: s.country,
          plannedAt: s.plannedAt ? new Date(s.plannedAt) : null,
        })),
      });
    }

    for (const [inventoryItemId, agg] of aggregatedEntries) {
      const { quantity, batchId, mixedBatches } = agg;

      const unitWhere: any = {
        tenantId,
        inventoryItemId,
        status: InventoryUnitStatus.Available,
        transportOrderId: null,
      };
      if (batchId && !mixedBatches) unitWhere.batchId = batchId;

      const availableUnits = await tx.inventory_units.findMany({
        where: unitWhere,
        orderBy: { createdAt: "asc" },
        take: quantity,
        select: { id: true },
      });

      if (availableUnits.length < quantity) {
        const item = await tx.inventory_items.findUnique({
          where: { id: inventoryItemId },
          select: { sku: true },
        });

        throw new BadRequestException(
          `Not enough available units for item ${
            item?.sku ?? inventoryItemId
          } (requested ${quantity}, available ${availableUnits.length})`,
        );
      }

      const unitIds = availableUnits.map((u) => u.id);

      await tx.inventory_units.updateMany({
        where: { tenantId, id: { in: unitIds } },
        data: {
          status: InventoryUnitStatus.Reserved,
          transportOrderId: newOrder.id,
        },
      });

      const effectiveBatchId = mixedBatches ? null : (batchId ?? null);

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
        select: { id: true },
      });

      await tx.transport_order_item_units.createMany({
        data: unitIds.map((inventoryUnitId) => ({
          tenantId,
          transportOrderItemId: orderItem.id,
          inventoryUnitId,
        })),
        skipDuplicates: true,
      });
    }

    return tx.transportOrder.findUniqueOrThrow({
      where: { id: newOrder.id },
    });
  }

  async createOrder(
    tenantId: string,
    payload: CreateOrderDto | { orders: CreateOrderDto[] },
  ): Promise<OrderDto | CreateOrdersBatchResult> {
    const maybeBatch = payload as any;
    const isBatch =
      maybeBatch && Array.isArray(maybeBatch.orders) && maybeBatch.orders.length > 0;

    if (!isBatch) {
      const dto = payload as CreateOrderDto;

      const existing = await this.prisma.transportOrder.findFirst({
        where: { tenantId, orderRef: dto.orderRef },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException({
          code: "DUPLICATE_ORDER_REF",
          message: "Order with this orderRef already exists for this tenant",
        });
      }

      const now = new Date();
      const yyyy = now.getUTCFullYear();
      const mm = now.getUTCMonth() + 1;

      const order = await this.prisma.$transaction(
        async (tx) => {
          const [sequenceInternalRef] = await this.allocateInternalRefBlock(
            tx,
            tenantId,
            yyyy,
            mm,
            1,
          );

          const internalRef = dto.internalRef?.trim() || sequenceInternalRef;
          return this.createOneOrderInTransaction(tx, tenantId, dto, internalRef);
        },
        { maxWait: 30_000, timeout: 60_000 },
      );

      return this.toDto(order);
    }

    const orders = (payload as any).orders as CreateOrderDto[];
    if (!orders.length) {
      throw new BadRequestException("orders array must not be empty");
    }

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = now.getUTCMonth() + 1;

    const orderRefs = orders.map((o) => o.orderRef?.trim()).filter(Boolean) as string[];
    const orderRefSet = new Set(orderRefs);
    if (orderRefSet.size !== orderRefs.length) {
      throw new BadRequestException("Duplicate orderRef values found in batch payload");
    }

    const created = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.transportOrder.findMany({
          where: {
            tenantId,
            orderRef: { in: orderRefs },
          },
          select: { orderRef: true },
        });

        if (existing.length) {
          const duplicateRef = existing[0].orderRef;
          throw new ConflictException({
            code: "DUPLICATE_ORDER_REF",
            message:
              "Order with this orderRef already exists for this tenant in the database",
            detail: { orderRef: duplicateRef },
          });
        }

        const allocatedRefs = await this.allocateInternalRefBlock(
          tx,
          tenantId,
          yyyy,
          mm,
          orders.length,
        );

        const result: CreatedOrderSummary[] = [];

        for (let i = 0; i < orders.length; i++) {
          const dto = orders[i];
          const allocatedInternalRef = allocatedRefs[i];

          const order = await this.createOneOrderInTransaction(
            tx,
            tenantId,
            dto,
            dto.internalRef?.trim() || allocatedInternalRef,
          );

          result.push({
            id: order.id,
            internalRef: (order as any).internalRef ?? allocatedInternalRef,
            externalRef: dto.orderRef ?? undefined,
          });
        }

        return result;
      },
      { maxWait: 30_000, timeout: 60_000 },
    );

    return {
      createdCount: created.length,
      created,
    };
  }

  async listOrders(
    tenantId: string,
    cursor?: string,
    limit: number = 20,
    customerCompanyId?: string,
  ): Promise<{ orders: OrderDto[]; nextCursor?: string }> {
    console.log("[Transport] tenantId:", tenantId);

    if (!tenantId) throw new BadRequestException("tenantId is required");

    const take = Math.min(limit, 100);

    const where: any = { tenantId };
    if (customerCompanyId) where.customerCompanyId = customerCompanyId;

    const orders = await this.prisma.transportOrder.findMany({
      where,
      take: take + 1,
      orderBy: { createdAt: "desc" },
    });

    const hasMore = orders.length > take;
    const result = hasMore ? orders.slice(0, take) : orders;
    const nextCursor = hasMore ? result[result.length - 1].id : undefined;

    return {
      orders: result.map((o) => this.toDto(o)),
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

    if (!order) return null;
    return this.toDtoWithStops(order);
  }

  async planTripFromOrder(tenantId: string, orderId: string): Promise<TripDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.transportOrder.findFirst({
        where: { id: orderId, tenantId },
      });
      if (!order) throw new NotFoundException("Order not found");

      const trip = await tx.trip.create({
        data: {
          tenantId,
          status: TripStatus.Draft,
          plannedStartAt: order.pickupWindowStart,
          plannedEndAt: order.deliveryWindowEnd,
        },
      });

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

    const tripWithStops = await this.prisma.trip.findUnique({
      where: { id: result.trip.id },
      include: {
        stops: {
          orderBy: { sequence: "asc" },
          include: { pods: { take: 1, orderBy: { createdAt: "desc" } } },
        },
        vehicles: true,
      },
    });

    if (!tripWithStops) throw new NotFoundException("Trip not found after creation");

    return this.tripToDto(
      tripWithStops,
      tripWithStops.stops.map((stop) => ({
        ...stop,
        pod: stop.pods[0] || null,
      })),
    );
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
            data: {
              status: "Available" as any,
              transportOrderId: null,
            },
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

      const lines = (dto.items ?? []).filter((x) => (x.qty ?? 0) > 0);

      const existing = await tx.transport_order_items.findMany({
        where: { tenantId, transportOrderId: orderId },
        include: { units: true },
      });

      const existingItemIds = new Set(existing.map((x) => x.id));

      // unlink units from existing items
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

      await tx.transport_order_items.deleteMany({
        where: { tenantId, transportOrderId: orderId },
      });

      for (const line of lines) {
        const item = await tx.inventory_items.findFirst({
          where: { tenantId, id: line.inventoryItemId },
        });
        if (!item) {
          throw new BadRequestException(
            `Inventory item not found: ${line.inventoryItemId}`,
          );
        }

        const orderItem = await tx.transport_order_items.create({
          data: {
            tenantId,
            transportOrderId: orderId,
            inventoryItemId: line.inventoryItemId,
            qty: line.qty,
            batchId: null,
          },
        });

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
            select: { id: true },
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
            select: { id: true },
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

  /**
   * Deletes an order and releases reserved units.
   * Blocks delete if order has an active trip (Dispatched/InTransit).
   */
  async deleteOrder(tenantId: string, orderId: string) {
    const order = await this.prisma.transportOrder.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException("Order not found");

    const locked = await this.prisma.stop.findFirst({
      where: {
        tenantId,
        transportOrderId: orderId,
        trip: { status: { in: [TripStatus.Dispatched, TripStatus.InTransit] } },
      },
      select: { id: true },
    });

    if (locked) throw new BadRequestException("Order is in an active trip");

    await this.prisma.$transaction(async (tx) => {
      // release units
      await tx.inventory_units.updateMany({
        where: { tenantId, transportOrderId: orderId },
        data: {
          status: InventoryUnitStatus.Available,
          transportOrderId: null,
          tripId: null,
          stopId: null,
        },
      });

      // delete unit links + item lines
      const itemIds = await tx.transport_order_items.findMany({
        where: { tenantId, transportOrderId: orderId },
        select: { id: true },
      });

      const ids = itemIds.map((x) => x.id);
      if (ids.length) {
        await tx.transport_order_item_units.deleteMany({
          where: { tenantId, transportOrderItemId: { in: ids } },
        });

        await tx.transport_order_items.deleteMany({
          where: { tenantId, transportOrderId: orderId },
        });
      }

      // delete stops
      await tx.stop.deleteMany({
        where: { tenantId, transportOrderId: orderId },
      });

      // delete order
      await tx.transportOrder.delete({
        where: { id: orderId },
      });
    });

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

  async updateOrderDo(tenantId: string, orderId: string, dto: any): Promise<OrderDto> {
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
        doSignedAt: dto.doSignedAt ? new Date(dto.doSignedAt) : order.doSignedAt,
        doStatus: dto.doStatus ?? order.doStatus,
        doVersion: { increment: 1 },
      },
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

    return this.toDtoWithStops(updated);
  }

  // ----------------------------
  // DTO mappers
  // ----------------------------
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
      customerContactNumber: order.customerContactNumber ?? null,

      status: order.status,
      pickupWindowStart: order.pickupWindowStart,
      pickupWindowEnd: order.pickupWindowEnd,
      deliveryWindowStart: order.deliveryWindowStart,
      deliveryWindowEnd: order.deliveryWindowEnd,
      notes: order.notes,

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

      createdAt: order.createdAt,
      updatedAt: order.updatedAt,

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
      assignedDriver: null,
      assignedVehicle: trip.vehicles
        ? {
            id: trip.vehicles.id,
            vehicleNumber: trip.vehicles.vehicleNumber,
            type: trip.vehicles.type ?? null,
          }
        : null,

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
}
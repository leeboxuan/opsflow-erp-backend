import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { ReceiveUnitsDto } from './dto/receive-units.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { ReserveItemsDto } from './dto/reserve-items.dto';
import { DispatchItemsDto } from './dto/dispatch-items.dto';
import { DeliverItemsDto } from './dto/deliver-items.dto';
import { BatchDto } from './dto/batch.dto';
import { InventoryItemDto } from './dto/inventory-item.dto';

// Local enums matching Prisma schema (avoids @prisma/client enum resolution issues)
const InventoryBatchStatus = {
  Draft: 'Draft',
  Open: 'Open',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
} as const;
type InventoryBatchStatus = (typeof InventoryBatchStatus)[keyof typeof InventoryBatchStatus];

const InventoryUnitStatus = {
  Available: 'Available',
  Reserved: 'Reserved',
  InTransit: 'InTransit',
  Delivered: 'Delivered',
  Returned: 'Returned',
  Damaged: 'Damaged',
  Cancelled: 'Cancelled',
} as const;
type InventoryUnitStatus = (typeof InventoryUnitStatus)[keyof typeof InventoryUnitStatus];

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recompute and update cached availableQty for an inventory item
   */
  private async updateAvailableQty(
    tenantId: string,
    inventoryItemId: string,
    tx?: any,
  ): Promise<void> {
    const prisma = tx || this.prisma;
    const count = await prisma.inventory_units.count({
      where: {
        tenantId,
        inventoryItemId,
        status: InventoryUnitStatus.Available,
      },
    });

    await prisma.inventory_items.update({
      where: { id: inventoryItemId },
      data: { availableQty: count },
    });
  }

  /**
   * GET /inventory/items/summary?search=
   * Returns items with counts by status (available, reserved, inTransit, delivered, total).
   */
  async getItemsSummary(
    tenantId: string,
    search?: string,
  ): Promise<
    Array<{
      id: string;
      sku: string;
      name: string;
      reference: string | null;
      counts: {
        available: number;
        reserved: number;
        inTransit: number;
        delivered: number;
        total: number;
      };
    }>
  > {
    const where: any = { tenantId };
    if (search) {
      where.OR = [
        { sku: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ];
    }
    const items = await this.prisma.inventory_items.findMany({
      where,
      select: { id: true, sku: true, name: true, reference: true },
      orderBy: { sku: 'asc' },
    });
    const units = await this.prisma.inventory_units.findMany({
      where: { tenantId },
      select: { inventoryItemId: true, status: true },
    });
    const byItem = new Map<
      string,
      { available: number; reserved: number; inTransit: number; delivered: number }
    >();
    for (const u of units) {
      let c = byItem.get(u.inventoryItemId);
      if (!c) {
        c = { available: 0, reserved: 0, inTransit: 0, delivered: 0 };
        byItem.set(u.inventoryItemId, c);
      }
      switch (u.status) {
        case InventoryUnitStatus.Available:
          c.available++;
          break;
        case InventoryUnitStatus.Reserved:
          c.reserved++;
          break;
        case InventoryUnitStatus.InTransit:
          c.inTransit++;
          break;
        case InventoryUnitStatus.Delivered:
          c.delivered++;
          break;
      }
    }
    return items.map((item) => {
      const c = byItem.get(item.id) ?? {
        available: 0,
        reserved: 0,
        inTransit: 0,
        delivered: 0,
      };
      const total =
        c.available + c.reserved + c.inTransit + c.delivered;
      return {
        id: item.id,
        sku: item.sku,
        name: item.name,
        reference: item.reference,
        counts: {
          available: c.available,
          reserved: c.reserved,
          inTransit: c.inTransit,
          delivered: c.delivered,
          total,
        },
      };
    });
  }

  /**
   * GET /inventory/items?search=
   */
  async searchItems(
    tenantId: string,
    search?: string,
  ): Promise<InventoryItemDto[]> {
    const where: any = { tenantId };
    if (search) {
      where.OR = [
        { sku: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ];
    }

    const items = await this.prisma.inventory_items.findMany({
      where,
      select: {
        id: true,
        sku: true,
        name: true,
        reference: true,
        unit: true,
        availableQty: true,
      },
      orderBy: { sku: 'asc' },
    });


    return items.map((item) => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      reference: item.reference,
      unit: item.unit,
      availableQty: item.availableQty ?? 0,
    }));
  }

  /**
   * POST /inventory/batches
   * If batchCode not provided, auto-generate: B + YYMMDD + "-" + 3-digit sequence per day (e.g. B260205-001).
   */
  async createBatch(
    tenantId: string,
    dto: CreateBatchDto,
  ): Promise<BatchDto> {
    let batchCode = dto.batchCode?.trim();
    if (!batchCode) {
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const prefix = `B${yy}${mm}${dd}-`;
      const todayCount = await this.prisma.inventory_batches.count({
        where: {
          tenantId,
          batchCode: { startsWith: prefix },
        },
      });
      const seq = (todayCount + 1).toString().padStart(3, '0');
      batchCode = `${prefix}${seq}`;
    }

    const existing = await this.prisma.inventory_batches.findUnique({
      where: {
        tenantId_batchCode: {
          tenantId,
          batchCode,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Batch with code ${batchCode} already exists`,
      );
    }

    const batch = await this.prisma.inventory_batches.create({
      data: {
        tenantId,
        batchCode,
        notes: dto.notes ?? null,
        status: InventoryBatchStatus.Draft,
      },
    });

    return this.toBatchDto(batch, {
      totalUnits: 0,
      availableUnits: 0,
      reservedUnits: 0,
      inTransitUnits: 0,
      deliveredUnits: 0,
    });
  }

  /**
   * POST /inventory/batches/:batchId/receive — Stock In: create batch_items + inventory_units.
   */
  async receiveStock(
    tenantId: string,
    batchId: string,
    dto: ReceiveStockDto,
  ): Promise<{
    items: Array<{
      inventoryItemId: string;
      sku: string;
      name: string;
      receivedQty: number;
      totalInBatch: number;
    }>;
    totalUnitsCreated: number;
  }> {
    const batch = await this.prisma.inventory_batches.findFirst({
      where: { id: batchId, tenantId },
    });
    if (!batch) {
      throw new NotFoundException('Batch not found');
    }
    if (batch.status === InventoryBatchStatus.Cancelled) {
      throw new BadRequestException('Cannot receive into a cancelled batch');
    }

    const format =
      dto.unitSkuFormat === 'ITEM-SEQ' ? 'ITEM-SEQ' : 'ITEM-BATCH-SEQ';

    return await this.prisma.$transaction(async (tx) => {
      const resultItems: Array<{
        inventoryItemId: string;
        sku: string;
        name: string;
        receivedQty: number;
        totalInBatch: number;
      }> = [];
      let totalUnitsCreated = 0;

      for (const line of dto.items) {
        if (line.quantity < 1) {
          throw new BadRequestException(
            `Quantity must be > 0 for item ${line.inventoryItemId}`,
          );
        }

        const item = await tx.inventory_items.findFirst({
          where: { id: line.inventoryItemId, tenantId },
        });
        if (!item) {
          throw new NotFoundException(
            `Inventory item not found: ${line.inventoryItemId}`,
          );
        }

        const existingBatchItem = await tx.inventory_batch_items.findUnique({
          where: {
            batchId_inventoryItemId: {
              batchId,
              inventoryItemId: line.inventoryItemId,
            },
          },
        });

        let totalInBatch: number;
        if (existingBatchItem) {
          totalInBatch = existingBatchItem.qty + line.quantity;
          await tx.inventory_batch_items.update({
            where: { id: existingBatchItem.id },
            data: { qty: totalInBatch, updatedAt: new Date() },
          });
        } else {
          totalInBatch = line.quantity;
          await tx.inventory_batch_items.create({
            data: {
              tenantId,
              batchId,
              inventoryItemId: line.inventoryItemId,
              qty: line.quantity,
            },
          });
        }

        const existingUnits = await tx.inventory_units.findMany({
          where: {
            tenantId,
            batchId,
            inventoryItemId: line.inventoryItemId,
          },
          select: { unitSku: true },
          orderBy: { createdAt: 'desc' },
        });

        const unitsToCreate: Array<{
          tenantId: string;
          inventoryItemId: string;
          batchId: string;
          unitSku: string;
          status: InventoryUnitStatus;
        }> = [];
        const baseSeq =
          format === 'ITEM-BATCH-SEQ'
            ? existingUnits.length + 1
            : await this.getNextItemSeqForTenant(tx, tenantId, line.inventoryItemId);

        for (let i = 0; i < line.quantity; i++) {
          const seq =
            format === 'ITEM-BATCH-SEQ'
              ? existingUnits.length + 1 + i
              : baseSeq + i;
          const padded = seq.toString().padStart(4, '0');
          const unitSku =
            format === 'ITEM-BATCH-SEQ'
              ? `${item.sku}-${batch.batchCode}-${padded}`
              : `${item.sku}-${padded}`;

          const exists = await tx.inventory_units.findUnique({
            where: {
              tenantId_unitSku: { tenantId, unitSku },
            },
          });
          if (exists) {
            throw new ConflictException(
              `Unit SKU already exists: ${unitSku}. Use a different unitSkuFormat or batch.`,
            );
          }
          unitsToCreate.push({
            tenantId,
            inventoryItemId: line.inventoryItemId,
            batchId,
            unitSku,
            status: InventoryUnitStatus.Available,
          });
        }

        await tx.inventory_units.createMany({
          data: unitsToCreate,
        });
        totalUnitsCreated += line.quantity;

        resultItems.push({
          inventoryItemId: line.inventoryItemId,
          sku: item.sku,
          name: item.name,
          receivedQty: line.quantity,
          totalInBatch,
        });
      }

      if (batch.status === InventoryBatchStatus.Draft) {
        await tx.inventory_batches.update({
          where: { id: batchId },
          data: {
            status: InventoryBatchStatus.Open,
            receivedAt: new Date(),
          },
        });
      }

      for (const it of resultItems) {
        await this.updateAvailableQty(tenantId, it.inventoryItemId, tx);
      }

      return {
        items: resultItems,
        totalUnitsCreated,
      };
    });
  }

  private async getNextItemSeqForTenant(
    tx: any,
    tenantId: string,
    inventoryItemId: string,
  ): Promise<number> {
    const units = await tx.inventory_units.findMany({
      where: { tenantId, inventoryItemId },
      select: { unitSku: true },
    });
    let maxSeq = 0;
    for (const u of units) {
      const match = u.unitSku.match(/-(\d+)$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxSeq) maxSeq = n;
      }
    }
    return maxSeq + 1;
  }

  /**
   * GET /inventory/batches/:batchId/summary
   */
  async getBatchSummary(
    tenantId: string,
    batchId: string,
  ): Promise<{
    id: string;
    batchCode: string;
    status: InventoryBatchStatus;
    items: Array<{
      inventoryItemId: string;
      sku: string;
      name: string;
      counts: {
        available: number;
        reserved: number;
        inTransit: number;
        delivered: number;
        total: number;
      };
    }>;
  }> {
    const batch = await this.prisma.inventory_batches.findFirst({
      where: { id: batchId, tenantId },
      include: {
        inventory_batch_items: {
          include: { inventory_item: true },
        },
      },
    });
    if (!batch) {
      throw new NotFoundException('Batch not found');
    }

    const unitCounts = await this.prisma.inventory_units.groupBy({
      by: ['inventoryItemId', 'status'],
      where: { tenantId, batchId },
      _count: { id: true },
    });

    const byItem = new Map<
      string,
      { available: number; reserved: number; inTransit: number; delivered: number }
    >();
    for (const row of unitCounts) {
      let c = byItem.get(row.inventoryItemId);
      if (!c) {
        c = { available: 0, reserved: 0, inTransit: 0, delivered: 0 };
        byItem.set(row.inventoryItemId, c);
      }
      const count = row._count?.id ?? 0;
      switch (row.status) {
        case InventoryUnitStatus.Available:
          c.available = count;
          break;
        case InventoryUnitStatus.Reserved:
          c.reserved = count;
          break;
        case InventoryUnitStatus.InTransit:
          c.inTransit = count;
          break;
        case InventoryUnitStatus.Delivered:
          c.delivered = count;
          break;
      }
    }

    const items = batch.inventory_batch_items.map((bi) => {
      const c = byItem.get(bi.inventoryItemId) ?? {
        available: 0,
        reserved: 0,
        inTransit: 0,
        delivered: 0,
      };
      const total =
        c.available + c.reserved + c.inTransit + c.delivered;
      return {
        inventoryItemId: bi.inventoryItemId,
        sku: bi.inventory_item.sku,
        name: bi.inventory_item.name,
        counts: {
          available: c.available,
          reserved: c.reserved,
          inTransit: c.inTransit,
          delivered: c.delivered,
          total,
        },
      };
    });

    return {
      id: batch.id,
      batchCode: batch.batchCode,
      status: batch.status,
      items,
    };
  }

  /**
   * POST /inventory/batches/:batchId/receive
   */
  async receiveUnits(
    tenantId: string,
    batchId: string,
    dto: ReceiveUnitsDto,
  ): Promise<{ batchId: string; unitsCreated: number; unitSkus: string[] }> {
    const batch = await this.prisma.inventory_batches.findFirst({
      where: { id: batchId, tenantId },
    });

    if (!batch) {
      throw new NotFoundException('Batch not found');
    }

    if (batch.status === InventoryBatchStatus.Cancelled) {
      throw new BadRequestException('Cannot receive units into a cancelled batch');
    }

    return await this.prisma.$transaction(async (tx) => {
      // Find or create inventory item
      let inventoryItem = await tx.inventory_items.findUnique({
        where: {
          tenantId_sku: {
            tenantId,
            sku: dto.inventorySku,
          },
        },
      });

      if (!inventoryItem) {
        inventoryItem = await (tx as any).inventory_items.create({
          data: {
            id: this.generateId(),
            tenantId,
            sku: dto.inventorySku,
            name: dto.inventoryName || dto.inventorySku,
            reference: dto.reference || null,
            availableQty: 0,
          },
        });
      }

      // Generate unit SKUs
      const unitSkus: string[] = [];
      const prefix = dto.unitSkuPrefix || `${batch.batchCode}-${dto.inventorySku}`;
      
      // Get existing units for this batch+item to determine next sequence
      const existingUnits = await tx.inventory_units.findMany({
        where: {
          tenantId,
          batchId,
          inventoryItemId: inventoryItem.id,
          unitSku: { startsWith: prefix },
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      let startSeq = 1;
      if (existingUnits.length > 0) {
        const lastSku = existingUnits[0].unitSku;
        const match = lastSku.match(/-(\d+)$/);
        if (match) {
          startSeq = parseInt(match[1], 10) + 1;
        }
      }

      // Create units with unique SKUs
      const unitsToCreate = [];
      for (let i = 0; i < dto.quantity; i++) {
        const seq = startSeq + i;
        const unitSku = `${prefix}-${seq.toString().padStart(4, '0')}`;
        unitSkus.push(unitSku);

        // Check for conflicts
        const existing = await tx.inventory_units.findUnique({
          where: {
            tenantId_unitSku: {
              tenantId,
              unitSku,
            },
          },
        });

        if (existing) {
          throw new ConflictException(`Unit SKU ${unitSku} already exists`);
        }

        unitsToCreate.push({
          tenantId,
          inventoryItemId: inventoryItem.id,
          batchId,
          unitSku,
          status: InventoryUnitStatus.Available,
        });
      }

      // Create all units
      await tx.inventory_units.createMany({
        data: unitsToCreate,
      });

      // Update cached availableQty
      await this.updateAvailableQty(tenantId, inventoryItem.id, tx);

      return {
        batchId,
        unitsCreated: dto.quantity,
        unitSkus,
      };
    });
  }

  /**
   * GET /inventory/batches
   */
  async listBatches(
    tenantId: string,
    customerName?: string,
    status?: InventoryBatchStatus,
  ): Promise<BatchDto[]> {
    const where: any = { tenantId };
    if (customerName) {
      where.customerName = { contains: customerName, mode: 'insensitive' };
    }
    if (status) {
      where.status = status;
    }

    const batches = await this.prisma.inventory_batches.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Get counts for each batch
    const batchesWithCounts = await Promise.all(
      batches.map(async (batch) => {
        const counts = await this.getBatchCounts(tenantId, batch.id);
        return this.toBatchDto(batch, counts);
      }),
    );

    return batchesWithCounts;
  }

  /**
   * GET /inventory/batches/:batchId
   */
  async getBatchById(tenantId: string, batchId: string): Promise<BatchDto> {
    const batch = await this.prisma.inventory_batches.findFirst({
      where: { id: batchId, tenantId },
    });

    if (!batch) {
      throw new NotFoundException('Batch not found');
    }

    const counts = await this.getBatchCounts(tenantId, batchId);
    return this.toBatchDto(batch, counts);
  }

  /**
   * POST /inventory/orders/:orderId/reserve
   */
  async reserveItems(
    tenantId: string,
    orderId: string,
    dto: ReserveItemsDto,
  ): Promise<{ reserved: number; items: Array<{ inventorySku: string; qty: number; unitSkus: string[] }> }> {
    // Verify order exists and belongs to tenant
    const order = await this.prisma.transportOrder.findFirst({
      where: { id: orderId, tenantId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return await this.prisma.$transaction(async (tx) => {
      const reservedItems: Array<{
        inventorySku: string;
        qty: number;
        unitSkus: string[];
      }> = [];
      let totalReserved = 0;

      for (const item of dto.items) {
        // Find inventory item
        const inventoryItem = await tx.inventory_items.findUnique({
          where: {
            tenantId_sku: {
              tenantId,
              sku: item.inventorySku,
            },
          },
        });

        if (!inventoryItem) {
          throw new NotFoundException(
            `Inventory item with SKU ${item.inventorySku} not found`,
          );
        }

        // Find available units
        const unitWhere: any = {
          tenantId,
          inventoryItemId: inventoryItem.id,
          status: InventoryUnitStatus.Available,
        };

        if (item.batchId) {
          unitWhere.batchId = item.batchId;
        }

        const availableUnits = await tx.inventory_units.findMany({
          where: unitWhere,
          orderBy: { createdAt: 'asc' },
          take: item.qty,
        });

        if (availableUnits.length < item.qty) {
          throw new BadRequestException(
            `Insufficient available units for SKU ${item.inventorySku}. Available: ${availableUnits.length}, Requested: ${item.qty}`,
          );
        }

        // Reserve units
        const unitIds = availableUnits.map((u) => u.id);
        await tx.inventory_units.updateMany({
          where: {
            id: { in: unitIds },
          },
          data: {
            status: InventoryUnitStatus.Reserved,
            transportOrderId: orderId,
          },
        });

        // Upsert transport_order_items (batchId stored but not in unique key)
        const existingItem = await tx.transport_order_items.findUnique({
          where: {
            transportOrderId_inventoryItemId: {
              transportOrderId: orderId,
              inventoryItemId: inventoryItem.id,
            },
          },
        });

        if (existingItem) {
          await tx.transport_order_items.update({
            where: { id: existingItem.id },
            data: {
              qty: item.qty,
              batchId: item.batchId || null,
            },
          });
        } else {
          await tx.transport_order_items.create({
            data: {
              tenantId,
              transportOrderId: orderId,
              inventoryItemId: inventoryItem.id,
              batchId: item.batchId || null,
              qty: item.qty,
            },
          });
        }

        // Update cached availableQty
        await this.updateAvailableQty(tenantId, inventoryItem.id, tx);

        reservedItems.push({
          inventorySku: item.inventorySku,
          qty: item.qty,
          unitSkus: availableUnits.map((u) => u.unitSku),
        });
        totalReserved += item.qty;
      }

      return {
        reserved: totalReserved,
        items: reservedItems,
      };
    });
  }

  /**
   * POST /inventory/orders/:orderId/dispatch
   */
  async dispatchItems(
    tenantId: string,
    orderId: string,
    dto: DispatchItemsDto,
  ): Promise<{ dispatched: number }> {
    const order = await this.prisma.transportOrder.findFirst({
      where: { id: orderId, tenantId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return await this.prisma.$transaction(async (tx) => {
      const where: any = {
        tenantId,
        transportOrderId: orderId,
        status: InventoryUnitStatus.Reserved,
      };

      if (dto.unitSkus && dto.unitSkus.length > 0) {
        where.unitSku = { in: dto.unitSkus };
      }

      const units = await tx.inventory_units.findMany({ where });

      if (units.length === 0) {
        throw new BadRequestException('No reserved units found for this order');
      }

      const updateData: any = {
        status: InventoryUnitStatus.InTransit,
      };

      if (dto.tripId) {
        updateData.tripId = dto.tripId;
      }
      if (dto.stopId) {
        updateData.stopId = dto.stopId;
      }

      await tx.inventory_units.updateMany({
        where: { id: { in: units.map((u) => u.id) } },
        data: updateData,
      });

      // Update cached counts for affected items
      const itemIds = [...new Set(units.map((u) => u.inventoryItemId))] as string[];
      for (const itemId of itemIds) {
        await this.updateAvailableQty(tenantId, itemId, tx);
      }

      return { dispatched: units.length };
    });
  }

  /**
   * POST /inventory/orders/:orderId/deliver
   */
  async deliverItems(
    tenantId: string,
    orderId: string,
    dto: DeliverItemsDto,
  ): Promise<{ delivered: number }> {
    const order = await this.prisma.transportOrder.findFirst({
      where: { id: orderId, tenantId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return await this.prisma.$transaction(async (tx) => {
      const where: any = {
        tenantId,
        transportOrderId: orderId,
        status: InventoryUnitStatus.InTransit,
      };

      if (dto.unitSkus && dto.unitSkus.length > 0) {
        where.unitSku = { in: dto.unitSkus };
      }

      const units = await tx.inventory_units.findMany({ where });

      if (units.length === 0) {
        throw new BadRequestException('No in-transit units found for this order');
      }

      await tx.inventory_units.updateMany({
        where: { id: { in: units.map((u) => u.id) } },
        data: {
          status: InventoryUnitStatus.Delivered,
        },
      });

      // Update cached counts
      const itemIds = [...new Set(units.map((u) => u.inventoryItemId))] as string[];
      for (const itemId of itemIds) {
        await this.updateAvailableQty(tenantId, itemId, tx);
      }

      return { delivered: units.length };
    });
  }

  /**
   * POST /inventory/orders/:orderId/cancel
   */
  async cancelReservation(
    tenantId: string,
    orderId: string,
  ): Promise<{ released: number }> {
    const order = await this.prisma.transportOrder.findFirst({
      where: { id: orderId, tenantId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return await this.prisma.$transaction(async (tx) => {
      const units = await tx.inventory_units.findMany({
        where: {
          tenantId,
          transportOrderId: orderId,
          status: InventoryUnitStatus.Reserved,
        },
      });

      if (units.length === 0) {
        return { released: 0 };
      }

      await tx.inventory_units.updateMany({
        where: {
          id: { in: units.map((u) => u.id) },
        },
        data: {
          status: InventoryUnitStatus.Available,
          transportOrderId: null,
        },
      });

      // Update cached counts
      const itemIds = [...new Set(units.map((u) => u.inventoryItemId))] as string[];
      for (const itemId of itemIds) {
        await this.updateAvailableQty(tenantId, itemId, tx);
      }

      return { released: units.length };
    });
  }

  /**
   * Helper: Get batch unit counts
   */
  private async getBatchCounts(
    tenantId: string,
    batchId: string,
  ): Promise<{
    totalUnits: number;
    availableUnits: number;
    reservedUnits: number;
    inTransitUnits: number;
    deliveredUnits: number;
  }> {
    const [total, available, reserved, inTransit, delivered] =
      await Promise.all([
        this.prisma.inventory_units.count({
          where: { tenantId, batchId },
        }),
        this.prisma.inventory_units.count({
          where: {
            tenantId,
            batchId,
            status: InventoryUnitStatus.Available,
          },
        }),
        this.prisma.inventory_units.count({
          where: {
            tenantId,
            batchId,
            status: InventoryUnitStatus.Reserved,
          },
        }),
        this.prisma.inventory_units.count({
          where: {
            tenantId,
            batchId,
            status: InventoryUnitStatus.InTransit,
          },
        }),
        this.prisma.inventory_units.count({
          where: {
            tenantId,
            batchId,
            status: InventoryUnitStatus.Delivered,
          },
        }),
      ]);

    return {
      totalUnits: total,
      availableUnits: available,
      reservedUnits: reserved,
      inTransitUnits: inTransit,
      deliveredUnits: delivered,
    };
  }

  /**
   * Helper: Convert batch to DTO
   */
  private toBatchDto(
    batch: any,
    counts: {
      totalUnits: number;
      availableUnits: number;
      reservedUnits: number;
      inTransitUnits: number;
      deliveredUnits: number;
    },
  ): BatchDto {
    return {
      id: batch.id,
      batchCode: batch.batchCode,
      customerName: batch.customerName,
      customerRef: batch.customerRef,
      receivedAt: batch.receivedAt,
      notes: batch.notes,
      status: batch.status,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      ...counts,
    };
  }

  /**
   * Generate ID (cuid-like, simple implementation)
   */
  private generateId(): string {
    return `cl${Date.now().toString(36)}${Math.random().toString(36).substr(2, 9)}`;
  }
}

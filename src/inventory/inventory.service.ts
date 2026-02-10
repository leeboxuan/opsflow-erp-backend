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
import { StockInDto } from './dto/stock-in.dto';
import { SearchUnitsQueryDto } from './dto/search-units-query.dto';
import { InventoryUnitStatus } from '@prisma/client';
// Local enums matching Prisma schema (avoids @prisma/client enum resolution issues)
const InventoryBatchStatus = {
  Draft: 'Draft',
  Open: 'Open',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
} as const;
type InventoryBatchStatus = (typeof InventoryBatchStatus)[keyof typeof InventoryBatchStatus];


type ListInventoryItemsArgs = {
  tenantId: string;
  limit: number;
  cursor: string | null;
  q: string | null;
  status: string | null; // optional
};
// const InventoryUnitStatus = {
//   Available: 'Available',
//   Reserved: 'Reserved',
//   InTransit: 'InTransit',
//   Delivered: 'Delivered',
//   Returned: 'Returned',
//   Damaged: 'Damaged',
//   Cancelled: 'Cancelled',
// } as const;
// type InventoryUnitStatus = (typeof InventoryUnitStatus)[keyof typeof InventoryUnitStatus];

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) { }

  // -----------------------------
  // Stock-In helpers
  // -----------------------------
  private normalizeCompanyName(name: string): string {
    return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private normalizeEmail(email: string): string {
    return String(email ?? '').trim().toLowerCase();
  }

  private normalizeSku(sku: string): string {
    return String(sku ?? '').trim();
  }

  private parseYyyyMmDdToUtcDate(dateStr: string): Date {
    // Treat YYYY-MM-DD as a date-only value. We store it at UTC midnight.
    const m = String(dateStr ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      throw new BadRequestException('batch.receivedDate must be YYYY-MM-DD');
    }
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
    if (Number.isNaN(dt.getTime())) {
      throw new BadRequestException('Invalid batch.receivedDate');
    }
    return dt;
  }

  private customerContactFallbackName(normalizedEmail: string): string {
    const localPart = String(normalizedEmail).split('@')[0] || 'In Charge';
    return localPart;
  }
  /**
   * Recompute and update cached availableQty for an inventory item
   */

  async listInventoryItems(args: ListInventoryItemsArgs) {
    const { tenantId, limit, cursor, q, status } = args;
  
    const where: any = { tenantId };
  
    if (q) {
      where.OR = [
        { sku: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ];
    }
  
    // If you have a status field on inventory_items (some designs do), filter it here.
    // If status is on inventory_units instead, do NOT filter here (that becomes a join-ish problem).
    if (status && status !== "all") {
      where.status = status;
    }
  
    // ✅ NEW: totalCount for "Page X of Y"
    const totalCount = await this.prisma.inventory_items.count({ where });
  
    const rowsPlusOne = await this.prisma.inventory_items.findMany({
      where,
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      orderBy: { id: "asc" }, // stable cursor order
      select: {
        id: true,
        sku: true,
        name: true,
        availableQty: true,
        updatedAt: true,
      },
    });
  
    const hasMore = rowsPlusOne.length > limit;
    const rows = hasMore ? rowsPlusOne.slice(0, limit) : rowsPlusOne;
  
    const nextCursor = hasMore ? rows[rows.length - 1]?.id ?? null : null;
  
    // ✅ include totalCount in response
    return { rows, nextCursor, hasMore, totalCount };
  }
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

  async updateUnitStatus(
    tenantId: string,
    unitId: string,
    status: InventoryUnitStatus,
  ): Promise<{ id: string; unitSku: string; status: InventoryUnitStatus; updatedAt: Date }> {
    const unit = await this.prisma.inventory_units.findFirst({
      where: { id: unitId, tenantId },
      select: {
        id: true,
        unitSku: true,
        status: true,
        transportOrderId: true,
        tripId: true,
        stopId: true,
      },
    });
  
    if (!unit) throw new NotFoundException('Inventory unit not found');
  
    // Safety: don’t let admins “make it Available” while it’s still assigned to an order/trip
    const isAssigned = Boolean(unit.transportOrderId || unit.tripId || unit.stopId);
    if (status === InventoryUnitStatus.Available && isAssigned) {
      throw new BadRequestException(
        'Cannot set to Available while unit is assigned to an order/trip. Unassign it first.',
      );
    }
  
    const updated = await this.prisma.inventory_units.update({
      where: { id: unitId },
      data: { status },
      select: { id: true, unitSku: true, status: true, updatedAt: true },
    });
  
    return updated;
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
        // we don't trust cached availableQty; we compute below
      },
      orderBy: { sku: 'asc' },
    });

    const ids = items.map((i) => i.id);
    if (ids.length === 0) return [];

    const counts = await this.prisma.inventory_units.groupBy({
      by: ['inventoryItemId'],
      where: {
        tenantId,
        inventoryItemId: { in: ids },
        status: InventoryUnitStatus.Available,
      },
      _count: { _all: true },
    });

    const availableByItemId = new Map<string, number>();
    for (const c of counts) {
      availableByItemId.set(c.inventoryItemId, c._count._all);
    }

    return items.map((item) => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      reference: item.reference,
      availableQty: availableByItemId.get(item.id) ?? 0,
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
  /**
  * POST /inventory/stock-in
  * One-shot Stock-In flow (transactional):
  * 1) Resolve/create customer company (tenant-scoped, case-insensitive, trimmed)
  * 2) Resolve/create contact by (companyId + email) (case-insensitive, trimmed)
  * 3) Create inventory batch linked to company + contact with metadata
  * 4) For each row: find-or-create inventory_item by SKU, then create inventory_units for quantity (unitSku generated)
  * 5) All in ONE transaction (no partial inserts)
  */

  async stockInFromClientSheet(
    tenantId: string,
    dto: StockInDto,
  ): Promise<{
    batchId: string;
    customerCompanyId: string;
    customerContactId: string;
    totalUnitsCreated: number;
  }> {
    if (!tenantId) {
      throw new BadRequestException('Tenant context is required');
    }

    const rawCompanyName = String(dto.customerCompany?.name ?? '').trim();
    const normalizedCompanyName = this.normalizeCompanyName(rawCompanyName);
    if (!rawCompanyName || !normalizedCompanyName) {
      throw new BadRequestException('customerCompany.name is required');
    }

    const rawEmail = String(dto.contact?.email ?? '').trim();
    const normalizedEmail = this.normalizeEmail(rawEmail);
    if (!normalizedEmail) {
      throw new BadRequestException('contact.email is required');
    }

    const batchCode = String(dto.batch?.batchCode ?? '').trim();
    if (!batchCode) {
      throw new BadRequestException('batch.batchCode is required');
    }

    const batchDescription = String(dto.batch?.batchDescription ?? '').trim();
    if (!batchDescription) {
      throw new BadRequestException('batch.batchDescription is required');
    }

    const receivedAt = this.parseYyyyMmDdToUtcDate(dto.batch.receivedDate);
    const notes = dto.batch.notes?.trim() || null;

    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('items must be a non-empty array');
    }

    return await this.prisma.$transaction(
      async (tx) => {
        // 1) Resolve company (dedupe by tenantId + normalizedName)
        const customerCompany = await tx.customer_companies.upsert({
          where: {
            tenantId_normalizedName: { tenantId, normalizedName: normalizedCompanyName },
          },
          update: { name: rawCompanyName },
          create: { tenantId, name: rawCompanyName, normalizedName: normalizedCompanyName },
        });

        // 2) Resolve contact (dedupe by companyId + normalizedEmail)
        const contactName =
          String(dto.contact?.name ?? '').trim() ||
          this.customerContactFallbackName(normalizedEmail);

        const customerContact = await tx.customer_contacts.upsert({
          where: {
            companyId_normalizedEmail: {
              companyId: customerCompany.id,
              normalizedEmail,
            },
          },
          update: { name: contactName, email: rawEmail },
          create: {
            companyId: customerCompany.id,
            name: contactName,
            email: rawEmail,
            normalizedEmail,
          },
        });

        // 3) Create batch (batchCode unique per tenant)
        const existingBatch = await tx.inventory_batches.findUnique({
          where: { tenantId_batchCode: { tenantId, batchCode } },
          select: { id: true },
        });
        if (existingBatch) {
          throw new ConflictException(`Batch with code ${batchCode} already exists`);
        }

        const batch = await tx.inventory_batches.create({
          data: {
            tenantId,
            batchCode,
            batchDescription,
            receivedAt,
            notes,
            status: InventoryBatchStatus.Open,
            customerCompanyId: customerCompany.id,
            customerContactId: customerContact.id,
            customerName: customerCompany.name, // legacy field
          },
        });

        // 4) Items -> inventory_items + batch_items + units
        let totalUnitsCreated = 0;

        for (const row of dto.items) {
          const skuInput = this.normalizeSku(row.itemSku);
          if (!skuInput) throw new BadRequestException('Each item must have itemSku');

          const quantity = (row.quantity ?? 1) as number;
          if (!Number.isInteger(quantity) || quantity < 1) {
            throw new BadRequestException(`Quantity must be >= 1 for itemSku ${skuInput}`);
          }

          // Find existing item by SKU (case-insensitive), else create
          let inventoryItem = await tx.inventory_items.findFirst({
            where: { tenantId, sku: { equals: skuInput, mode: 'insensitive' } },
          });

          if (!inventoryItem) {
            const normalizedSku = skuInput;
            inventoryItem = await tx.inventory_items.create({
              data: {
                id: `${tenantId}_${normalizedSku}`,
                tenantId,
                sku: normalizedSku,
                name: (row.itemName?.trim() || normalizedSku) as string,
                reference: row.itemDescription?.trim() || null,
                availableQty: 0,
                updatedAt: new Date(),
              },
            });
          } else {
            // Optional enrichment if client provided name/desc
            const maybeName = row.itemName?.trim();
            const maybeRef = row.itemDescription?.trim();
            if (maybeName || maybeRef) {
              await tx.inventory_items.update({
                where: { id: inventoryItem.id },
                data: {
                  name: maybeName || inventoryItem.name,
                  reference: maybeRef ?? inventoryItem.reference,
                  updatedAt: new Date(),
                },
              });
            }
          }

          // Upsert batch_items (unique: batchId + inventoryItemId)
          await tx.inventory_batch_items.upsert({
            where: {
              batchId_inventoryItemId: { batchId: batch.id, inventoryItemId: inventoryItem.id },
            },
            update: { qty: { increment: quantity } },
            create: {
              tenantId,
              batchId: batch.id,
              inventoryItemId: inventoryItem.id,
              qty: quantity,
            },
          });

          // Generate unitSkus: <itemSku>-<batchSeq4>-<unitSeq2>
          // Example: LLSG-CB-Q-MSM-0001-01
          const batchSeq4 = String(batch.batchCode.split("-").pop() ?? "").padStart(4, "0");
          const prefix = `${inventoryItem.sku}-${batchSeq4}-`;

          // FAST: get last unitSku once (so we continue the sequence)
          const lastUnit = await tx.inventory_units.findFirst({
            where: {
              tenantId,
              batchId: batch.id,
              inventoryItemId: inventoryItem.id,
              unitSku: { startsWith: prefix },
            },
            select: { unitSku: true },
            orderBy: { unitSku: "desc" }, // OK because unit seq is fixed-width (2 digits)
          });

          let maxSeq = 0;
          if (lastUnit?.unitSku) {
            const m = lastUnit.unitSku.match(/-(\d{2})$/);
            if (m) maxSeq = parseInt(m[1], 10);
          }

          const unitsToCreate: Array<{
            tenantId: string;
            inventoryItemId: string;
            batchId: string;
            unitSku: string;
            status: InventoryUnitStatus;
          }> = [];

          for (let i = 0; i < quantity; i++) {
            const seq = maxSeq + 1 + i;

            if (seq > 99) {
              throw new BadRequestException(
                `Unit sequence exceeded 99 for ${inventoryItem.sku} in batch ${batch.batchCode}. Use 3-digit unit seq if needed.`
              );
            }

            const padded = seq.toString().padStart(2, "0");

            unitsToCreate.push({
              tenantId,
              inventoryItemId: inventoryItem.id,
              batchId: batch.id,
              unitSku: `${prefix}${padded}`,
              status: InventoryUnitStatus.Available,
            });
          }

          // No per-unit existence checks: let unique constraint do its job
          await tx.inventory_units.createMany({ data: unitsToCreate });

          // Cheap + correct (since we're creating Available units)
          await tx.inventory_items.update({
            where: { id: inventoryItem.id },
            data: { availableQty: { increment: quantity }, updatedAt: new Date() },
          });

          totalUnitsCreated += quantity;
        }

        return {
          batchId: batch.id,
          customerCompanyId: customerCompany.id,
          customerContactId: customerContact.id,
          totalUnitsCreated,
        };
      },
      // IMPORTANT: prevent “Transaction not found” from timeout spikes
      { maxWait: 10_000, timeout: 60_000 },
    );
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
        let orderItemId: string;

        const existingItem = await tx.transport_order_items.findUnique({
          where: {
            transportOrderId_inventoryItemId: {
              transportOrderId: orderId,
              inventoryItemId: inventoryItem.id,
            },
          },
        });

        if (existingItem) {
          const updated = await tx.transport_order_items.update({
            where: { id: existingItem.id },
            data: {
              qty: item.qty,
              batchId: item.batchId || null,
            },
          });
          orderItemId = updated.id;
        } else {
          const created = await tx.transport_order_items.create({
            data: {
              tenantId,
              transportOrderId: orderId,
              inventoryItemId: inventoryItem.id,
              batchId: item.batchId || null,
              qty: item.qty,
            },
          });
          orderItemId = created.id;
        }
        await tx.transport_order_item_units.deleteMany({
          where: { tenantId, transportOrderItemId: orderItemId },
        });

        // ✅ Create links for the reserved unit ids
        await tx.transport_order_item_units.createMany({
          data: unitIds.map((inventoryUnitId) => ({
            tenantId,
            transportOrderItemId: orderItemId,
            inventoryUnitId,
          })),
        });
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
    },
      {
        maxWait: 10_000,
        timeout: 60_000,
      },);
  }
  async releaseUnits(
    tenantId: string,
    orderId: string,
    dto: { unitSkus: string[] },
  ): Promise<{ released: number }> {
    // verify order exists
    const order = await this.prisma.transportOrder.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) throw new NotFoundException('Order not found');

    return this.prisma.$transaction(async (tx) => {
      // load units by unitSku that are reserved for this order
      const units = await tx.inventory_units.findMany({
        where: {
          tenantId,
          unitSku: { in: dto.unitSkus },
          status: InventoryUnitStatus.Reserved,
          transportOrderId: orderId,
        },
      });

      if (!units.length) return { released: 0 };

      // find their link rows (which order item each unit belongs to)
      const links = await tx.transport_order_item_units.findMany({
        where: {
          tenantId,
          inventoryUnitId: { in: units.map((u) => u.id) },
        },
      });

      // delete link rows
      await tx.transport_order_item_units.deleteMany({
        where: {
          tenantId,
          inventoryUnitId: { in: units.map((u) => u.id) },
        },
      });

      // release units back to available
      await tx.inventory_units.updateMany({
        where: { tenantId, id: { in: units.map((u) => u.id) } },
        data: {
          status: InventoryUnitStatus.Available,
          transportOrderId: null,
          tripId: null,
          stopId: null,
        },
      });

      // decrement qty on the affected transport_order_items
      const countByOrderItem = new Map<string, number>();
      for (const l of links) {
        countByOrderItem.set(
          l.transportOrderItemId,
          (countByOrderItem.get(l.transportOrderItemId) ?? 0) + 1,
        );
      }

      for (const [transportOrderItemId, dec] of countByOrderItem.entries()) {
        const item = await tx.transport_order_items.findFirst({
          where: { id: transportOrderItemId, tenantId },
        });
        if (!item) continue;

        const nextQty = Math.max(0, item.qty - dec);

        if (nextQty === 0) {
          await tx.transport_order_items.delete({ where: { id: item.id } });
        } else {
          await tx.transport_order_items.update({
            where: { id: item.id },
            data: { qty: nextQty },
          });
        }

        // refresh cached inventory qty
        await this.updateAvailableQty(tenantId, item.inventoryItemId, tx);
      }

      return { released: units.length };
    },
      {
        maxWait: 10_000,
        timeout: 60_000,
      },);
  }


  async listUnits(
    tenantId: string,
    inventoryItemId: string,
    status: string,
    limit = 50,
  ) {
    return this.prisma.inventory_units.findMany({
      where: {
        tenantId,
        inventoryItemId,
        status: status as any,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        unitSku: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        batchId: true,
        transportOrderId: true,
        inventory_item: { select: { sku: true, name: true } },
        batch: { select: { batchCode: true } },
      },
    });
  }

  /**
 * GET /inventory/units/search
 * Supports prefix search (fast) + contains search + filters.
 */
  /**
 * GET /inventory/units/search
 * Ops unit-register response:
 * - unitSku, status
 * - itemSku, itemName
 * - batchCode
 * - createdAt, updatedAt
 * - transportOrderId / tripId / stopId (if present)
 */
  async searchUnits(
    tenantId: string,
    query: SearchUnitsQueryDto,
  ): Promise<{
    rows: Array<{
      id: string;
      unitSku: string;
      status: string;
      inventoryItemId: string;
      itemSku: string;
      itemName: string | null;
      batchId: string;
      batchCode: string | null;
      transportOrderId: string | null;
      tripId: string | null;
      stopId: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
    totalCount: number;
  }> {
    const limit = Math.min(Number(query.limit ?? 25), 200);
    const cursor = query.cursor?.trim() || null;

    const where: any = { tenantId };

    if (query.status) where.status = query.status as any;
    if (query.batchId) where.batchId = query.batchId;
    if (query.transportOrderId) where.transportOrderId = query.transportOrderId;

    if (query.prefix && String(query.prefix).trim()) {
      where.unitSku = { startsWith: String(query.prefix).trim() };
    }

    if (query.itemSku && String(query.itemSku).trim()) {
      where.inventory_item = {
        sku: { equals: String(query.itemSku).trim(), mode: 'insensitive' },
      };
    }

    if (query.search && String(query.search).trim()) {
      const s = String(query.search).trim();
      where.OR = [
        { unitSku: { contains: s, mode: 'insensitive' } },
        { inventory_item: { sku: { contains: s, mode: 'insensitive' } } },
        { inventory_item: { name: { contains: s, mode: 'insensitive' } } },
        { batch: { batchCode: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const unitsPlusOne = await this.prisma.inventory_units.findMany({
      where,
      take: limit + 1,
      ...(cursor
        ? {
          cursor: { id: cursor },
          skip: 1,
        }
        : {}),
      // stable order: updatedAt desc + id desc
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        unitSku: true,
        status: true,
        inventoryItemId: true,
        batchId: true,
        transportOrderId: true,
        tripId: true as any,
        stopId: true as any,
        createdAt: true,
        updatedAt: true,
        inventory_item: { select: { sku: true, name: true } },
        batch: { select: { batchCode: true } },
      },
    });

    const totalCount = await this.prisma.inventory_units.count({ where });


    const hasMore = unitsPlusOne.length > limit;
    const page = hasMore ? unitsPlusOne.slice(0, limit) : unitsPlusOne;

    const rows = page.map((u: any) => ({
      id: u.id,
      unitSku: u.unitSku,
      status: u.status,
      inventoryItemId: u.inventoryItemId,
      itemSku: u.inventory_item?.sku ?? '',
      itemName: u.inventory_item?.name ?? null,
      batchId: u.batchId,
      batchCode: u.batch?.batchCode ?? null,
      transportOrderId: u.transportOrderId ?? null,
      tripId: u.tripId ?? null,
      stopId: u.stopId ?? null,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));

    const nextCursor = hasMore ? rows[rows.length - 1]?.id ?? null : null;

    return { rows, nextCursor, hasMore, totalCount };
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
    }, {
      maxWait: 10_000,
      timeout: 60_000,
    },);
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
    },
      {
        maxWait: 10_000,
        timeout: 60_000,
      },);
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

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WarehouseJobType } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';

export const WAREHOUSE_INVENTORY_MUTATION_DISABLED_MESSAGE =
  'Inventory status mutation from warehouse jobs is not enabled yet.';

export const TRANSPORT_INVENTORY_FIELD_FORBIDDEN_MESSAGE =
  'Transport fields must not be included in warehouse inventory mutations';

const FORBIDDEN_TRANSPORT_INVENTORY_FIELDS = [
  'transportOrderId',
  'tripId',
  'stopId',
] as const;

export type WarehouseInventoryMutationPayload = Record<string, unknown>;

export type ResolvedInventoryUnit = {
  id: string;
  unitSku: string;
  inventoryItemId: string;
  batchId: string;
  status: string;
};

export type WarehouseJobLineInventoryRef = {
  inventoryItemId: string | null;
  inventoryBatchId: string | null;
};

/**
 * Read-only inventory coordination for Warehouse Jobs.
 * Future inventory mutations must go through this service only — never via transport tables.
 */
@Injectable()
export class WarehouseInventoryBridgeService {
  constructor(private readonly prisma: PrismaService) {}

  async assertInventoryItemBelongsToTenant(
    tenantId: string,
    inventoryItemId?: string | null,
  ): Promise<void> {
    if (!inventoryItemId) return;

    const item = await this.prisma.inventory_items.findFirst({
      where: { id: inventoryItemId, tenantId },
      select: { id: true },
    });

    if (!item) {
      throw new NotFoundException('Inventory item not found in this tenant');
    }
  }

  async assertInventoryBatchBelongsToTenant(
    tenantId: string,
    inventoryBatchId?: string | null,
  ): Promise<void> {
    if (!inventoryBatchId) return;

    const batch = await this.prisma.inventory_batches.findFirst({
      where: { id: inventoryBatchId, tenantId },
      select: { id: true },
    });

    if (!batch) {
      throw new NotFoundException('Inventory batch not found in this tenant');
    }
  }

  async assertItemBelongsToBatch(
    tenantId: string,
    inventoryItemId: string,
    inventoryBatchId: string,
  ): Promise<void> {
    const membership = await this.prisma.inventory_batch_items.findFirst({
      where: {
        tenantId,
        batchId: inventoryBatchId,
        inventoryItemId,
      },
      select: { id: true },
    });

    if (!membership) {
      throw new BadRequestException(
        'Inventory item is not part of the specified batch',
      );
    }
  }

  async resolveInventoryUnitsForTenant(
    tenantId: string,
    input: { inventoryUnitIds?: string[]; unitSkus?: string[] },
  ): Promise<ResolvedInventoryUnit[]> {
    const ids = [...new Set((input.inventoryUnitIds ?? []).filter(Boolean))];
    const skus = [...new Set((input.unitSkus ?? []).filter(Boolean))];

    if (ids.length === 0 && skus.length === 0) {
      throw new BadRequestException(
        'At least one inventoryUnitId or unitSku is required',
      );
    }

    const byId = ids.length
      ? await this.prisma.inventory_units.findMany({
          where: { tenantId, id: { in: ids } },
          select: {
            id: true,
            unitSku: true,
            inventoryItemId: true,
            batchId: true,
            status: true,
          },
        })
      : [];

    if (ids.length > 0 && byId.length !== ids.length) {
      const found = new Set(byId.map((unit) => unit.id));
      const missing = ids.filter((id) => !found.has(id));
      throw new NotFoundException(
        `Inventory unit(s) not found in this tenant: ${missing.join(', ')}`,
      );
    }

    const bySku = skus.length
      ? await this.prisma.inventory_units.findMany({
          where: { tenantId, unitSku: { in: skus } },
          select: {
            id: true,
            unitSku: true,
            inventoryItemId: true,
            batchId: true,
            status: true,
          },
        })
      : [];

    if (skus.length > 0 && bySku.length !== skus.length) {
      const found = new Set(bySku.map((unit) => unit.unitSku));
      const missing = skus.filter((sku) => !found.has(sku));
      throw new NotFoundException(
        `Inventory unit SKU(s) not found in this tenant: ${missing.join(', ')}`,
      );
    }

    const merged = new Map<string, ResolvedInventoryUnit>();
    for (const unit of [...byId, ...bySku]) {
      merged.set(unit.id, unit);
    }

    return [...merged.values()];
  }

  async assertLineInventoryCompatibility(
    tenantId: string,
    line: WarehouseJobLineInventoryRef,
    units: ResolvedInventoryUnit[],
  ): Promise<void> {
    for (const unit of units) {
      if (line.inventoryItemId && unit.inventoryItemId !== line.inventoryItemId) {
        throw new BadRequestException(
          `Unit ${unit.unitSku} does not match line inventory item`,
        );
      }
      if (line.inventoryBatchId && unit.batchId !== line.inventoryBatchId) {
        throw new BadRequestException(
          `Unit ${unit.unitSku} does not match line inventory batch`,
        );
      }
    }

    if (line.inventoryItemId && line.inventoryBatchId) {
      await this.assertItemBelongsToBatch(
        tenantId,
        line.inventoryItemId,
        line.inventoryBatchId,
      );
    }
  }

  /**
   * Future guardrail: call before any warehouse-job inventory status mutation.
   * v1 rejects all job types until product-specific transition DTOs exist.
   */
  assertWarehouseJobTypeCanMutateInventory(type: WarehouseJobType): void {
    void type;
    throw new BadRequestException(WAREHOUSE_INVENTORY_MUTATION_DISABLED_MESSAGE);
  }

  /**
   * Future guardrail: call before any warehouse-job inventory write payload is applied.
   * Rejects transport-scoped inventory unit fields.
   */
  assertNoTransportInventoryFieldsInMutationPayload(
    payload: WarehouseInventoryMutationPayload,
  ): void {
    for (const field of FORBIDDEN_TRANSPORT_INVENTORY_FIELDS) {
      if (field in payload && payload[field] !== undefined) {
        throw new BadRequestException(TRANSPORT_INVENTORY_FIELD_FORBIDDEN_MESSAGE);
      }
    }
  }
}

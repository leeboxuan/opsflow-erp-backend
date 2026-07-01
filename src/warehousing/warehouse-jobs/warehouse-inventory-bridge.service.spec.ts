import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WarehouseJobType } from '@prisma/client';
import {
  TRANSPORT_INVENTORY_FIELD_FORBIDDEN_MESSAGE,
  WAREHOUSE_INVENTORY_MUTATION_DISABLED_MESSAGE,
  WarehouseInventoryBridgeService,
} from './warehouse-inventory-bridge.service';

describe('WarehouseInventoryBridgeService', () => {
  const tenantId = 'tenant-1';
  const otherTenantId = 'tenant-2';
  const inventoryItemId = 'item-1';
  const inventoryBatchId = 'batch-1';

  function makePrisma(overrides: Partial<any> = {}) {
    return {
      inventory_items: {
        findFirst: jest.fn().mockResolvedValue({ id: inventoryItemId }),
      },
      inventory_batches: {
        findFirst: jest.fn().mockResolvedValue({ id: inventoryBatchId }),
      },
      inventory_batch_items: {
        findFirst: jest.fn().mockResolvedValue({ id: 'batch-item-1' }),
      },
      inventory_units: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      transport_order_items: {
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      transport_order_item_units: {
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      ...overrides,
    };
  }

  function makeService(prisma: any = makePrisma()) {
    return {
      service: new WarehouseInventoryBridgeService(prisma),
      prisma,
    };
  }

  describe('assertItemBelongsToBatch', () => {
    it('passes when inventory_batch_items has matching tenant, batch, item', async () => {
      const prisma = makePrisma();
      const { service } = makeService(prisma);

      await expect(
        service.assertItemBelongsToBatch(
          tenantId,
          inventoryItemId,
          inventoryBatchId,
        ),
      ).resolves.toBeUndefined();

      expect(prisma.inventory_batch_items.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId,
          batchId: inventoryBatchId,
          inventoryItemId,
        },
        select: { id: true },
      });
    });

    it('rejects when item is not in batch', async () => {
      const prisma = makePrisma();
      prisma.inventory_batch_items.findFirst.mockResolvedValue(null);
      const { service } = makeService(prisma);

      await expect(
        service.assertItemBelongsToBatch(
          tenantId,
          inventoryItemId,
          inventoryBatchId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('assertInventoryItemBelongsToTenant', () => {
    it('rejects item from another tenant', async () => {
      const prisma = makePrisma();
      prisma.inventory_items.findFirst.mockResolvedValue(null);
      const { service } = makeService(prisma);

      await expect(
        service.assertInventoryItemBelongsToTenant(otherTenantId, inventoryItemId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assertInventoryBatchBelongsToTenant', () => {
    it('rejects batch from another tenant', async () => {
      const prisma = makePrisma();
      prisma.inventory_batches.findFirst.mockResolvedValue(null);
      const { service } = makeService(prisma);

      await expect(
        service.assertInventoryBatchBelongsToTenant(otherTenantId, inventoryBatchId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveInventoryUnitsForTenant', () => {
    it('deduplicates ids/skus and rejects missing units', async () => {
      const unit = {
        id: 'unit-1',
        unitSku: 'U-001',
        inventoryItemId,
        batchId: inventoryBatchId,
        status: 'Available',
      };
      const prisma = makePrisma();
      prisma.inventory_units.findMany
        .mockResolvedValueOnce([unit])
        .mockResolvedValueOnce([unit]);
      const { service } = makeService(prisma);

      const resolved = await service.resolveInventoryUnitsForTenant(tenantId, {
        inventoryUnitIds: ['unit-1', 'unit-1'],
        unitSkus: ['U-001'],
      });

      expect(resolved).toHaveLength(1);
      expect(resolved[0].id).toBe('unit-1');
    });

    it('rejects when unit id is missing in tenant', async () => {
      const prisma = makePrisma();
      prisma.inventory_units.findMany.mockResolvedValueOnce([]);
      const { service } = makeService(prisma);

      await expect(
        service.resolveInventoryUnitsForTenant(tenantId, {
          inventoryUnitIds: ['missing-unit'],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assertWarehouseJobTypeCanMutateInventory', () => {
    it.each([
      WarehouseJobType.RECEIVE,
      WarehouseJobType.PUTAWAY,
      WarehouseJobType.PICK,
      WarehouseJobType.PACK,
      WarehouseJobType.STOCK_ADJUSTMENT,
      WarehouseJobType.RETURN_PROCESSING,
      WarehouseJobType.INTERNAL_MOVE,
      WarehouseJobType.CYCLE_COUNT,
    ])('rejects %s', (type) => {
      const { service } = makeService();

      expect(() => service.assertWarehouseJobTypeCanMutateInventory(type)).toThrow(
        WAREHOUSE_INVENTORY_MUTATION_DISABLED_MESSAGE,
      );
      expect(() => service.assertWarehouseJobTypeCanMutateInventory(type)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('assertNoTransportInventoryFieldsInMutationPayload', () => {
    it('rejects transportOrderId', () => {
      const { service } = makeService();

      expect(() =>
        service.assertNoTransportInventoryFieldsInMutationPayload({
          transportOrderId: 'order-1',
        }),
      ).toThrow(TRANSPORT_INVENTORY_FIELD_FORBIDDEN_MESSAGE);
    });

    it('rejects tripId', () => {
      const { service } = makeService();

      expect(() =>
        service.assertNoTransportInventoryFieldsInMutationPayload({
          tripId: 'trip-1',
        }),
      ).toThrow(TRANSPORT_INVENTORY_FIELD_FORBIDDEN_MESSAGE);
    });

    it('rejects stopId', () => {
      const { service } = makeService();

      expect(() =>
        service.assertNoTransportInventoryFieldsInMutationPayload({
          stopId: 'stop-1',
        }),
      ).toThrow(TRANSPORT_INVENTORY_FIELD_FORBIDDEN_MESSAGE);
    });

    it('allows safe payload with no transport fields', () => {
      const { service } = makeService();

      expect(() =>
        service.assertNoTransportInventoryFieldsInMutationPayload({
          status: 'Available',
          inventoryUnitId: 'unit-1',
        }),
      ).not.toThrow();
    });
  });

  describe('read-only guarantee', () => {
    it('helpers do not call inventory_units.update/updateMany', async () => {
      const prisma = makePrisma();
      prisma.inventory_units.findMany.mockResolvedValue([
        {
          id: 'unit-1',
          unitSku: 'U-001',
          inventoryItemId,
          batchId: inventoryBatchId,
          status: 'Available',
        },
      ]);
      const { service } = makeService(prisma);

      await service.assertInventoryItemBelongsToTenant(tenantId, inventoryItemId);
      await service.assertInventoryBatchBelongsToTenant(tenantId, inventoryBatchId);
      await service.assertItemBelongsToBatch(
        tenantId,
        inventoryItemId,
        inventoryBatchId,
      );
      await service.resolveInventoryUnitsForTenant(tenantId, {
        inventoryUnitIds: ['unit-1'],
      });
      await service.assertLineInventoryCompatibility(
        tenantId,
        { inventoryItemId, inventoryBatchId },
        [
          {
            id: 'unit-1',
            unitSku: 'U-001',
            inventoryItemId,
            batchId: inventoryBatchId,
            status: 'Available',
          },
        ],
      );
      service.assertNoTransportInventoryFieldsInMutationPayload({
        inventoryUnitId: 'unit-1',
      });

      expect(prisma.inventory_units.update).not.toHaveBeenCalled();
      expect(prisma.inventory_units.updateMany).not.toHaveBeenCalled();
    });

    it('helpers do not touch transport models', async () => {
      const prisma = makePrisma();
      const { service } = makeService(prisma);

      await service.assertInventoryItemBelongsToTenant(tenantId, inventoryItemId);
      await service.assertInventoryBatchBelongsToTenant(tenantId, inventoryBatchId);
      await service.assertItemBelongsToBatch(
        tenantId,
        inventoryItemId,
        inventoryBatchId,
      );
      service.assertNoTransportInventoryFieldsInMutationPayload({
        status: 'Available',
      });

      expect(prisma.transport_order_items.update).not.toHaveBeenCalled();
      expect(prisma.transport_order_items.updateMany).not.toHaveBeenCalled();
      expect(prisma.transport_order_item_units.update).not.toHaveBeenCalled();
      expect(prisma.transport_order_item_units.updateMany).not.toHaveBeenCalled();
    });
  });
});

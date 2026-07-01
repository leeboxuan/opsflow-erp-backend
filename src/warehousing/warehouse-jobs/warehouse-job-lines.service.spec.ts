import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  WarehouseJobEventType,
  WarehouseJobStatus,
} from '@prisma/client';
import { WarehouseJobEventsService } from './warehouse-job-events.service';
import { WarehouseJobLinesService } from './warehouse-job-lines.service';
import { WarehouseInventoryBridgeService } from './warehouse-inventory-bridge.service';

describe('WarehouseJobLinesService', () => {
  const tenantId = 'tenant-1';
  const otherTenantId = 'tenant-2';
  const warehouseJobId = 'job-1';
  const lineId = 'line-1';
  const actorUserId = 'user-ops';

  function makeJob(overrides: Partial<any> = {}) {
    return {
      id: warehouseJobId,
      tenantId,
      status: WarehouseJobStatus.DRAFT,
      ...overrides,
    };
  }

  function makeLine(overrides: Partial<any> = {}) {
    return {
      id: lineId,
      tenantId,
      warehouseJobId,
      inventoryItemId: 'item-1',
      inventoryBatchId: null,
      description: null,
      requestedQty: 5,
      completedQty: 0,
      sortOrder: 0,
      notes: null,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      inventoryItem: {
        id: 'item-1',
        sku: 'SKU-1',
        name: 'Widget',
        reference: 'REF-1',
      },
      inventoryBatch: null,
      _count: { units: 0 },
      ...overrides,
    };
  }

  function makeService() {
    const eventsService = {
      append: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    } as unknown as WarehouseJobEventsService;

    const tx = {
      warehouseJobLine: {
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      warehouseJobUnit: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };

    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => {
        if (typeof cb === 'function') return cb(tx);
        return Promise.all(cb);
      }),
      warehouseJob: {
        findFirst: jest.fn().mockResolvedValue(makeJob()),
      },
      warehouseJobLine: {
        findMany: jest.fn().mockResolvedValue([makeLine()]),
        findFirst: jest.fn().mockResolvedValue(makeLine()),
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
      },
      warehouseJobUnit: {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      inventory_items: {
        findFirst: jest.fn().mockResolvedValue({ id: 'item-1' }),
      },
      inventory_batches: {
        findFirst: jest.fn().mockResolvedValue({ id: 'batch-1' }),
      },
      inventory_batch_items: {
        findFirst: jest.fn().mockResolvedValue({ id: 'batch-item-1' }),
      },
    };

    const inventoryBridge = new WarehouseInventoryBridgeService(prisma);
    const service = new WarehouseJobLinesService(
      prisma,
      eventsService,
      inventoryBridge,
    );

    return { service, prisma, tx, eventsService };
  }

  describe('list', () => {
    it('validates parent job tenant scope', async () => {
      const { service, prisma } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(null);

      await expect(service.list(tenantId, warehouseJobId)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(prisma.warehouseJob.findFirst).toHaveBeenCalledWith({
        where: { id: warehouseJobId, tenantId },
        select: { id: true, status: true },
      });
    });

    it('returns tenant-scoped lines ordered by sortOrder', async () => {
      const { service, prisma } = makeService();

      await service.list(tenantId, warehouseJobId);

      expect(prisma.warehouseJobLine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, warehouseJobId },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
      );
    });
  });

  describe('create', () => {
    it('rejects parent job in IN_PROGRESS, COMPLETED, or CANCELLED', async () => {
      const { service, prisma } = makeService();

      for (const status of [
        WarehouseJobStatus.IN_PROGRESS,
        WarehouseJobStatus.COMPLETED,
        WarehouseJobStatus.CANCELLED,
      ]) {
        prisma.warehouseJob.findFirst.mockResolvedValue(makeJob({ status }));
        await expect(
          service.create(
            tenantId,
            warehouseJobId,
            { requestedQty: 1, inventoryItemId: 'item-1' },
            actorUserId,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('validates inventoryItemId tenant', async () => {
      const { service, prisma } = makeService();
      prisma.inventory_items.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          tenantId,
          warehouseJobId,
          { requestedQty: 1, inventoryItemId: 'missing-item' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('validates inventoryBatchId tenant', async () => {
      const { service, prisma } = makeService();
      prisma.inventory_batches.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          tenantId,
          warehouseJobId,
          { requestedQty: 1, inventoryBatchId: 'missing-batch' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects inventoryItemId + inventoryBatchId mismatch on create', async () => {
      const { service, prisma } = makeService();
      prisma.inventory_batch_items.findFirst.mockResolvedValue(null);

      await expect(
        service.create(tenantId, warehouseJobId, {
          requestedQty: 1,
          inventoryItemId: 'item-1',
          inventoryBatchId: 'batch-1',
        }),
      ).rejects.toThrow('Inventory item is not part of the specified batch');
    });

    it('accepts valid item + batch on create', async () => {
      const { service, tx } = makeService();
      tx.warehouseJobLine.create.mockResolvedValue(
        makeLine({ inventoryBatchId: 'batch-1' }),
      );

      await expect(
        service.create(tenantId, warehouseJobId, {
          requestedQty: 1,
          inventoryItemId: 'item-1',
          inventoryBatchId: 'batch-1',
        }),
      ).resolves.toBeDefined();
    });

    it('requires description if no item or batch', async () => {
      const { service } = makeService();

      await expect(
        service.create(tenantId, warehouseJobId, { requestedQty: 1 }),
      ).rejects.toThrow(
        'Description is required when no inventory item or batch is specified',
      );
    });

    it('writes LINE_ADDED event', async () => {
      const { service, tx, eventsService } = makeService();
      const created = makeLine();
      tx.warehouseJobLine.create.mockResolvedValue(created);

      await service.create(
        tenantId,
        warehouseJobId,
        { requestedQty: 5, inventoryItemId: 'item-1' },
        actorUserId,
      );

      expect(eventsService.append).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: WarehouseJobEventType.LINE_ADDED,
          warehouseJobId,
          tenantId,
          actorUserId,
        }),
      );
    });
  });

  describe('update', () => {
    it('rejects completedQty > requestedQty', async () => {
      const { service } = makeService();

      await expect(
        service.update(tenantId, warehouseJobId, lineId, { completedQty: 10 }),
      ).rejects.toThrow('completedQty cannot exceed requestedQty');

      await expect(
        service.update(tenantId, warehouseJobId, lineId, {
          requestedQty: 2,
          completedQty: 5,
        }),
      ).rejects.toThrow('completedQty cannot exceed requestedQty');
    });

    it('rejects mutation when parent job is terminal or in progress', async () => {
      const { service, prisma } = makeService();

      for (const status of [
        WarehouseJobStatus.IN_PROGRESS,
        WarehouseJobStatus.COMPLETED,
        WarehouseJobStatus.CANCELLED,
      ]) {
        prisma.warehouseJob.findFirst.mockResolvedValue(makeJob({ status }));
        await expect(
          service.update(tenantId, warehouseJobId, lineId, { notes: 'n' }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('writes LINE_UPDATED event', async () => {
      const { service, tx, eventsService } = makeService();
      tx.warehouseJobLine.update.mockResolvedValue(
        makeLine({ notes: 'updated' }),
      );

      await service.update(
        tenantId,
        warehouseJobId,
        lineId,
        { notes: 'updated' },
        actorUserId,
      );

      expect(eventsService.append).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: WarehouseJobEventType.LINE_UPDATED,
          payload: expect.objectContaining({
            lineId,
            changedFields: { notes: 'updated' },
          }),
        }),
      );
    });

    it('rejects resulting inventoryItemId + inventoryBatchId mismatch on update', async () => {
      const { service, prisma } = makeService();
      prisma.warehouseJobLine.findFirst.mockResolvedValue(
        makeLine({ inventoryItemId: 'item-1', inventoryBatchId: 'batch-1' }),
      );
      prisma.inventory_batch_items.findFirst.mockResolvedValue(null);

      await expect(
        service.update(tenantId, warehouseJobId, lineId, {
          inventoryItemId: 'item-2',
        }),
      ).rejects.toThrow('Inventory item is not part of the specified batch');
    });

    it('accepts valid resulting item + batch on update', async () => {
      const { service, prisma, tx } = makeService();
      prisma.warehouseJobLine.findFirst.mockResolvedValue(
        makeLine({ inventoryItemId: 'item-1', inventoryBatchId: null }),
      );
      tx.warehouseJobLine.update.mockResolvedValue(
        makeLine({ inventoryItemId: 'item-1', inventoryBatchId: 'batch-1' }),
      );

      await expect(
        service.update(tenantId, warehouseJobId, lineId, {
          inventoryBatchId: 'batch-1',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('delete', () => {
    it('rejects if linked units exist', async () => {
      const { service, prisma } = makeService();
      prisma.warehouseJobUnit.count.mockResolvedValue(2);

      await expect(
        service.delete(tenantId, warehouseJobId, lineId, actorUserId),
      ).rejects.toThrow('Cannot delete line with linked units.');
    });

    it('writes LINE_REMOVED event', async () => {
      const { service, tx, eventsService } = makeService();

      await service.delete(tenantId, warehouseJobId, lineId, actorUserId);

      expect(eventsService.append).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: WarehouseJobEventType.LINE_REMOVED,
          payload: expect.objectContaining({ lineId }),
        }),
      );
      expect(tx.warehouseJobLine.delete).toHaveBeenCalledWith({
        where: { id: lineId },
      });
    });
  });

  describe('tenant isolation', () => {
    it('finds lines with tenantId in where clause', async () => {
      const { service, prisma } = makeService();
      prisma.warehouseJobLine.findFirst.mockResolvedValue(null);

      await expect(
        service.update(otherTenantId, warehouseJobId, lineId, { notes: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.warehouseJobLine.findFirst).toHaveBeenCalledWith({
        where: { id: lineId, warehouseJobId, tenantId: otherTenantId },
      });
    });
  });
});

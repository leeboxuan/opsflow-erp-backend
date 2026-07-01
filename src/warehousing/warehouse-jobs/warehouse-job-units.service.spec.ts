import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  WarehouseJobEventType,
  WarehouseJobStatus,
  WarehouseJobUnitLinkStatus,
} from '@prisma/client';
import { WarehouseJobEventsService } from './warehouse-job-events.service';
import { WarehouseJobUnitsService } from './warehouse-job-units.service';
import { WarehouseInventoryBridgeService } from './warehouse-inventory-bridge.service';
import { WarehouseJobLifecycleService } from './warehouse-job-lifecycle.service';

describe('WarehouseJobUnitsService', () => {
  const tenantId = 'tenant-1';
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
      inventoryBatchId: 'batch-1',
      ...overrides,
    };
  }

  function makeInventoryUnit(overrides: Partial<any> = {}) {
    return {
      id: 'unit-1',
      unitSku: 'U-001',
      inventoryItemId: 'item-1',
      batchId: 'batch-1',
      status: 'Available',
      ...overrides,
    };
  }

  function makeLink(overrides: Partial<any> = {}) {
    return {
      id: 'link-1',
      tenantId,
      warehouseJobId,
      warehouseJobLineId: lineId,
      inventoryUnitId: 'unit-1',
      linkStatus: WarehouseJobUnitLinkStatus.PLANNED,
      confirmedAt: null,
      releasedAt: null,
      ...overrides,
    };
  }

  function makeService() {
    const eventsService = {
      append: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    } as unknown as WarehouseJobEventsService;

    const tx = {
      warehouseJob: {
        findFirst: jest.fn().mockResolvedValue({
          id: warehouseJobId,
          status: WarehouseJobStatus.IN_PROGRESS,
          completedAt: null,
        }),
        update: jest.fn().mockResolvedValue(
          makeJob({ status: WarehouseJobStatus.COMPLETED }),
        ),
      },
      warehouseJobUnit: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(makeLink()),
        update: jest.fn().mockResolvedValue(makeLink()),
        findMany: jest.fn().mockResolvedValue([makeLink()]),
        count: jest.fn().mockResolvedValue(0),
      },
      warehouseJobLine: {
        findFirst: jest.fn().mockResolvedValue({
          id: lineId,
          requestedQty: 5,
        }),
        findMany: jest.fn().mockResolvedValue([
          { requestedQty: 5, completedQty: 1 },
        ]),
        update: jest.fn().mockResolvedValue({ id: lineId, completedQty: 1 }),
      },
    };

    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      warehouseJob: {
        findFirst: jest.fn().mockResolvedValue(makeJob()),
      },
      warehouseJobLine: {
        findFirst: jest.fn().mockResolvedValue(makeLine()),
      },
      warehouseJobUnit: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      inventory_units: {
        findMany: jest.fn().mockResolvedValue([makeInventoryUnit()]),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      inventory_batch_items: {
        findFirst: jest.fn().mockResolvedValue({ id: 'batch-item-1' }),
      },
    };

    const inventoryBridge = new WarehouseInventoryBridgeService(prisma);
    const lifecycleService = new WarehouseJobLifecycleService(
      prisma,
      eventsService,
    );
    const service = new WarehouseJobUnitsService(
      prisma,
      eventsService,
      inventoryBridge,
      lifecycleService,
    );

    return { service, prisma, tx, eventsService, lifecycleService };
  }

  describe('list', () => {
    it('validates parent job tenant scope', async () => {
      const { service, prisma } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(null);

      await expect(service.list(tenantId, warehouseJobId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('link', () => {
    it('rejects COMPLETED or CANCELLED job', async () => {
      const { service, prisma } = makeService();

      for (const status of [
        WarehouseJobStatus.COMPLETED,
        WarehouseJobStatus.CANCELLED,
      ]) {
        prisma.warehouseJob.findFirst.mockResolvedValue(makeJob({ status }));
        await expect(
          service.linkToLine(
            tenantId,
            warehouseJobId,
            lineId,
            { inventoryUnitIds: ['unit-1'] },
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('validates line belongs to job and tenant', async () => {
      const { service, prisma } = makeService();
      prisma.warehouseJobLine.findFirst.mockResolvedValue(null);

      await expect(
        service.linkToLine(
          tenantId,
          warehouseJobId,
          lineId,
          { inventoryUnitIds: ['unit-1'] },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('validates inventory units belong to tenant', async () => {
      const { service, prisma } = makeService();
      prisma.inventory_units.findMany.mockResolvedValue([]);

      await expect(
        service.linkToJob(tenantId, warehouseJobId, {
          inventoryUnitIds: ['missing-unit'],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('requires at least one unit id or SKU', async () => {
      const { service } = makeService();

      await expect(
        service.linkToJob(tenantId, warehouseJobId, {}),
      ).rejects.toThrow('At least one inventoryUnitId or unitSku is required');
    });

    it('deduplicates units and creates PLANNED links without mutating inventory_units', async () => {
      const { service, prisma, tx, eventsService } = makeService();
      prisma.inventory_units.findMany
        .mockResolvedValueOnce([makeInventoryUnit()])
        .mockResolvedValueOnce([makeInventoryUnit()]);
      tx.warehouseJobUnit.create.mockResolvedValue(makeLink());

      const result = await service.linkToJob(tenantId, warehouseJobId, {
        inventoryUnitIds: ['unit-1', 'unit-1'],
        unitSkus: ['U-001'],
      });

      expect(result.linked).toBe(1);
      expect(tx.warehouseJobUnit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            linkStatus: WarehouseJobUnitLinkStatus.PLANNED,
            inventoryUnitId: 'unit-1',
          }),
        }),
      );
      expect(prisma.inventory_units.update).not.toHaveBeenCalled();
      expect(prisma.inventory_units.updateMany).not.toHaveBeenCalled();
      expect(eventsService.append).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: WarehouseJobEventType.UNIT_LINKED,
        }),
      );
    });

    it('rejects unit that does not match line inventory item', async () => {
      const { service, prisma } = makeService();
      prisma.inventory_units.findMany.mockResolvedValue([
        makeInventoryUnit({ inventoryItemId: 'other-item' }),
      ]);

      await expect(
        service.linkToLine(
          tenantId,
          warehouseJobId,
          lineId,
          { inventoryUnitIds: ['unit-1'] },
        ),
      ).rejects.toThrow('does not match line inventory item');
    });

    it('rejects unit whose batch differs from line inventoryBatchId', async () => {
      const { service, prisma } = makeService();
      prisma.inventory_units.findMany.mockResolvedValue([
        makeInventoryUnit({ batchId: 'other-batch' }),
      ]);

      await expect(
        service.linkToLine(
          tenantId,
          warehouseJobId,
          lineId,
          { inventoryUnitIds: ['unit-1'] },
        ),
      ).rejects.toThrow('does not match line inventory batch');
    });

    it('accepts unit matching line item + batch', async () => {
      const { service, prisma, tx } = makeService();
      prisma.inventory_units.findMany.mockResolvedValue([makeInventoryUnit()]);
      tx.warehouseJobUnit.create.mockResolvedValue(makeLink());

      const result = await service.linkToLine(
        tenantId,
        warehouseJobId,
        lineId,
        { inventoryUnitIds: ['unit-1'] },
      );

      expect(result.linked).toBe(1);
      expect(prisma.inventory_units.update).not.toHaveBeenCalled();
      expect(prisma.inventory_units.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    it('rejects unlinked units', async () => {
      const { service, prisma, tx } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.OPEN }),
      );
      tx.warehouseJobUnit.findMany.mockResolvedValue([]);

      await expect(
        service.confirmForJob(tenantId, warehouseJobId, {
          inventoryUnitIds: ['unit-1'],
        }),
      ).rejects.toThrow('Units not linked to warehouse job');
    });

    it('sets CONFIRMED and confirmedAt without mutating inventory_units', async () => {
      const { service, prisma, tx, eventsService } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.IN_PROGRESS }),
      );
      tx.warehouseJobUnit.findMany.mockResolvedValue([makeLink()]);
      tx.warehouseJobUnit.count.mockResolvedValue(1);

      const result = await service.confirmForJob(
        tenantId,
        warehouseJobId,
        { inventoryUnitIds: ['unit-1'] },
        actorUserId,
      );

      expect(result.confirmed).toBe(1);
      expect(tx.warehouseJobUnit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            linkStatus: WarehouseJobUnitLinkStatus.CONFIRMED,
            confirmedAt: expect.any(Date),
            releasedAt: null,
          }),
        }),
      );
      expect(prisma.inventory_units.update).not.toHaveBeenCalled();
      expect(eventsService.append).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: WarehouseJobEventType.UNIT_CONFIRMED,
        }),
      );
    });

    it('updates line completedQty when confirming PLANNED units linked to a line', async () => {
      const { service, prisma, tx } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.OPEN }),
      );
      tx.warehouseJobUnit.findMany.mockResolvedValue([makeLink()]);
      tx.warehouseJobUnit.count.mockResolvedValue(1);

      const result = await service.confirmForLine(
        tenantId,
        warehouseJobId,
        lineId,
        { inventoryUnitIds: ['unit-1'] },
      );

      expect(result.updatedCompletedQtyByLine).toEqual({ [lineId]: 1 });
      expect(tx.warehouseJobLine.update).toHaveBeenCalledWith({
        where: { id: lineId },
        data: { completedQty: 1 },
      });
    });

    it('does not update any line when confirming job-level units without lineId', async () => {
      const { service, prisma, tx } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.OPEN }),
      );
      tx.warehouseJobUnit.findMany.mockResolvedValue([
        makeLink({ warehouseJobLineId: null }),
      ]);

      const result = await service.confirmForJob(tenantId, warehouseJobId, {
        inventoryUnitIds: ['unit-1'],
      });

      expect(result.updatedCompletedQtyByLine).toEqual({});
      expect(tx.warehouseJobLine.update).not.toHaveBeenCalled();
    });

    it('does not double-count when confirming already CONFIRMED units', async () => {
      const { service, prisma, tx } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.OPEN }),
      );
      tx.warehouseJobUnit.findMany.mockResolvedValue([
        makeLink({ linkStatus: WarehouseJobUnitLinkStatus.CONFIRMED }),
      ]);
      tx.warehouseJobUnit.count.mockResolvedValue(1);

      const result = await service.confirmForLine(
        tenantId,
        warehouseJobId,
        lineId,
        { inventoryUnitIds: ['unit-1'] },
      );

      expect(result.confirmed).toBe(0);
      expect(result.alreadyConfirmed).toBe(1);
      expect(tx.warehouseJobUnit.update).not.toHaveBeenCalled();
      expect(tx.warehouseJobLine.update).toHaveBeenCalledWith({
        where: { id: lineId },
        data: { completedQty: 1 },
      });
    });

    it('rejects confirm if confirmed count would exceed requestedQty', async () => {
      const { service, prisma, tx } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.OPEN }),
      );
      tx.warehouseJobLine.findFirst.mockResolvedValue({
        id: lineId,
        requestedQty: 1,
      });
      tx.warehouseJobUnit.findMany.mockResolvedValue([
        makeLink({ id: 'link-1', inventoryUnitId: 'unit-1' }),
        makeLink({ id: 'link-2', inventoryUnitId: 'unit-2' }),
      ]);
      tx.warehouseJobUnit.count.mockResolvedValue(0);
      prisma.inventory_units.findMany.mockResolvedValue([
        makeInventoryUnit({ id: 'unit-1' }),
        makeInventoryUnit({ id: 'unit-2', unitSku: 'U-002' }),
      ]);

      await expect(
        service.confirmForLine(tenantId, warehouseJobId, lineId, {
          inventoryUnitIds: ['unit-1', 'unit-2'],
        }),
      ).rejects.toThrow('Confirming units would exceed line requestedQty');
    });

    it('recalculates each affected line on job-level confirm with mixed lines', async () => {
      const { service, prisma, tx } = makeService();
      const line2 = 'line-2';
      prisma.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.OPEN }),
      );
      tx.warehouseJobUnit.findMany.mockResolvedValue([
        makeLink({ id: 'link-1', inventoryUnitId: 'unit-1', warehouseJobLineId: lineId }),
        makeLink({ id: 'link-2', inventoryUnitId: 'unit-2', warehouseJobLineId: line2 }),
      ]);
      tx.warehouseJobUnit.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);

      prisma.inventory_units.findMany.mockResolvedValue([
        makeInventoryUnit({ id: 'unit-1' }),
        makeInventoryUnit({ id: 'unit-2', unitSku: 'U-002' }),
      ]);

      const result = await service.confirmForJob(tenantId, warehouseJobId, {
        inventoryUnitIds: ['unit-1', 'unit-2'],
      });

      expect(result.updatedCompletedQtyByLine).toEqual({
        [lineId]: 1,
        [line2]: 1,
      });
      expect(tx.warehouseJobLine.update).toHaveBeenCalledTimes(2);
    });

    it('rejects confirm when job is DRAFT', async () => {
      const { service } = makeService();

      await expect(
        service.confirmForJob(tenantId, warehouseJobId, {
          inventoryUnitIds: ['unit-1'],
        }),
      ).rejects.toThrow('Cannot confirm units when warehouse job status is DRAFT');
    });
  });

  describe('auto-complete parent job', () => {
    it('confirm triggering final line completion auto-completes parent job', async () => {
      const { service, prisma, tx, eventsService } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.IN_PROGRESS }),
      );
      tx.warehouseJobUnit.findMany.mockResolvedValue([makeLink()]);
      tx.warehouseJobUnit.count
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(5);
      tx.warehouseJobLine.findFirst.mockResolvedValue({
        id: lineId,
        requestedQty: 5,
      });
      tx.warehouseJobLine.findMany.mockResolvedValue([
        { requestedQty: 5, completedQty: 5 },
      ]);

      const result = await service.confirmForLine(
        tenantId,
        warehouseJobId,
        lineId,
        { inventoryUnitIds: ['unit-1'] },
        actorUserId,
      );

      expect(result.autoCompleted).toBe(true);
      expect(tx.warehouseJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WarehouseJobStatus.COMPLETED,
            completedAt: expect.any(Date),
          }),
        }),
      );
      expect(eventsService.append).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: WarehouseJobEventType.STATUS_CHANGED,
          fromStatus: WarehouseJobStatus.IN_PROGRESS,
          toStatus: WarehouseJobStatus.COMPLETED,
        }),
      );
      expect(prisma.inventory_units.update).not.toHaveBeenCalled();
      expect(prisma.inventory_units.updateMany).not.toHaveBeenCalled();
    });

    it('confirm that does not complete all lines does not auto-complete', async () => {
      const { service, prisma, tx } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.IN_PROGRESS }),
      );
      tx.warehouseJobUnit.findMany.mockResolvedValue([makeLink()]);
      tx.warehouseJobUnit.count.mockResolvedValue(1);
      tx.warehouseJobLine.findMany.mockResolvedValue([
        { requestedQty: 5, completedQty: 1 },
      ]);

      const result = await service.confirmForLine(
        tenantId,
        warehouseJobId,
        lineId,
        { inventoryUnitIds: ['unit-1'] },
      );

      expect(result.autoCompleted).toBe(false);
      expect(tx.warehouseJob.update).not.toHaveBeenCalled();
    });

    it('release does not reopen completed jobs', async () => {
      const { service, prisma } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.COMPLETED }),
      );

      await expect(
        service.releaseForLine(tenantId, warehouseJobId, lineId, {
          inventoryUnitIds: ['unit-1'],
        }),
      ).rejects.toThrow('Cannot modify units when warehouse job status is COMPLETED');
    });
  });

  describe('release', () => {
    it('sets RELEASED and releasedAt without deleting rows or mutating inventory_units', async () => {
      const { service, prisma, tx, eventsService } = makeService();
      tx.warehouseJobUnit.findMany.mockResolvedValue([
        makeLink({ linkStatus: WarehouseJobUnitLinkStatus.CONFIRMED }),
      ]);

      const result = await service.releaseForJob(
        tenantId,
        warehouseJobId,
        { inventoryUnitIds: ['unit-1'] },
        actorUserId,
      );

      expect(result.released).toBe(1);
      expect(tx.warehouseJobUnit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            linkStatus: WarehouseJobUnitLinkStatus.RELEASED,
            releasedAt: expect.any(Date),
          }),
        }),
      );
      expect(prisma.inventory_units.update).not.toHaveBeenCalled();
      expect(eventsService.append).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: WarehouseJobEventType.UNIT_RELEASED,
        }),
      );
    });

    it('lowers line completedQty when releasing CONFIRMED units linked to a line', async () => {
      const { service, tx } = makeService();
      tx.warehouseJobUnit.findMany.mockResolvedValue([
        makeLink({ linkStatus: WarehouseJobUnitLinkStatus.CONFIRMED }),
      ]);
      tx.warehouseJobUnit.count.mockResolvedValue(0);

      const result = await service.releaseForLine(
        tenantId,
        warehouseJobId,
        lineId,
        { inventoryUnitIds: ['unit-1'] },
      );

      expect(result.updatedCompletedQtyByLine).toEqual({ [lineId]: 0 });
      expect(tx.warehouseJobLine.update).toHaveBeenCalledWith({
        where: { id: lineId },
        data: { completedQty: 0 },
      });
    });

    it('is idempotent when releasing already RELEASED units', async () => {
      const { service, tx } = makeService();
      tx.warehouseJobUnit.findMany.mockResolvedValue([
        makeLink({ linkStatus: WarehouseJobUnitLinkStatus.RELEASED }),
      ]);
      tx.warehouseJobUnit.count.mockResolvedValue(0);

      const result = await service.releaseForLine(
        tenantId,
        warehouseJobId,
        lineId,
        { inventoryUnitIds: ['unit-1'] },
      );

      expect(result.released).toBe(0);
      expect(result.alreadyReleased).toBe(1);
      expect(tx.warehouseJobUnit.update).not.toHaveBeenCalled();
      expect(tx.warehouseJobLine.update).toHaveBeenCalledWith({
        where: { id: lineId },
        data: { completedQty: 0 },
      });
    });

    it('recalculates each affected line on job-level release with mixed lines', async () => {
      const { service, prisma, tx } = makeService();
      const line2 = 'line-2';
      tx.warehouseJobUnit.findMany.mockResolvedValue([
        makeLink({
          id: 'link-1',
          inventoryUnitId: 'unit-1',
          warehouseJobLineId: lineId,
          linkStatus: WarehouseJobUnitLinkStatus.CONFIRMED,
        }),
        makeLink({
          id: 'link-2',
          inventoryUnitId: 'unit-2',
          warehouseJobLineId: line2,
          linkStatus: WarehouseJobUnitLinkStatus.CONFIRMED,
        }),
      ]);
      tx.warehouseJobUnit.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);

      prisma.inventory_units.findMany.mockResolvedValue([
        makeInventoryUnit({ id: 'unit-1' }),
        makeInventoryUnit({ id: 'unit-2', unitSku: 'U-002' }),
      ]);

      const result = await service.releaseForJob(tenantId, warehouseJobId, {
        inventoryUnitIds: ['unit-1', 'unit-2'],
      });

      expect(result.updatedCompletedQtyByLine).toEqual({
        [lineId]: 0,
        [line2]: 1,
      });
      expect(tx.warehouseJobLine.update).toHaveBeenCalledTimes(2);
    });
  });
});

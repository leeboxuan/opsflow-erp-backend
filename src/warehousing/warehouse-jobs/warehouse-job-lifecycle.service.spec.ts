import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  WarehouseJobEventType,
  WarehouseJobPriority,
  WarehouseJobStatus,
  WarehouseJobType,
} from '@prisma/client';
import { WarehouseJobEventsService } from './warehouse-job-events.service';
import { WarehouseJobLifecycleService } from './warehouse-job-lifecycle.service';

describe('WarehouseJobLifecycleService', () => {
  const tenantA = 'tenant-a';
  const tenantB = 'tenant-b';
  const jobId = 'job-1';

  function makeJob(overrides: Partial<any> = {}) {
    return {
      id: jobId,
      tenantId: tenantA,
      internalRef: 'WH-2026-07-0001',
      status: WarehouseJobStatus.DRAFT,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelledReason: null,
      ...overrides,
    };
  }

  function makeService() {
    const eventsService = {
      append: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    } as unknown as WarehouseJobEventsService;

    const tx = {
      warehouseJob: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      warehouseJobLine: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };

    const service = new WarehouseJobLifecycleService(prisma, eventsService);

    return { service, prisma, tx, eventsService };
  }

  describe('allocateInternalRef', () => {
    it('generates WH-{YYYY}-{MM}-{seq4} and scopes counter by tenant', async () => {
      const { service } = makeService();
      const tx: any = {
        warehouse_job_internal_ref_counters: {
          upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
        },
      };

      const ref = await service.allocateInternalRef(
        tx,
        tenantA,
        new Date('2026-07-15T12:00:00.000Z'),
      );

      expect(ref).toBe('WH-2026-07-0001');
      expect(tx.warehouse_job_internal_ref_counters.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId_yyyymm: { tenantId: tenantA, yyyymm: '2026-07' } },
        }),
      );

      await service.allocateInternalRef(
        tx,
        tenantB,
        new Date('2026-07-15T12:00:00.000Z'),
      );

      expect(tx.warehouse_job_internal_ref_counters.upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { tenantId_yyyymm: { tenantId: tenantB, yyyymm: '2026-07' } },
        }),
      );
    });
  });

  describe('assertTransition', () => {
    it('allows valid transitions', () => {
      const { service } = makeService();
      expect(() =>
        service.assertTransition(WarehouseJobStatus.DRAFT, WarehouseJobStatus.OPEN),
      ).not.toThrow();
      expect(() =>
        service.assertTransition(
          WarehouseJobStatus.OPEN,
          WarehouseJobStatus.IN_PROGRESS,
        ),
      ).not.toThrow();
      expect(() =>
        service.assertTransition(
          WarehouseJobStatus.IN_PROGRESS,
          WarehouseJobStatus.COMPLETED,
        ),
      ).not.toThrow();
      expect(() =>
        service.assertTransition(
          WarehouseJobStatus.OPEN,
          WarehouseJobStatus.CANCELLED,
        ),
      ).not.toThrow();
    });

    it('rejects invalid transitions', () => {
      const { service } = makeService();
      expect(() =>
        service.assertTransition(WarehouseJobStatus.DRAFT, WarehouseJobStatus.IN_PROGRESS),
      ).toThrow(BadRequestException);
      expect(() =>
        service.assertTransition(WarehouseJobStatus.OPEN, WarehouseJobStatus.COMPLETED),
      ).toThrow(BadRequestException);
      expect(() =>
        service.assertTransition(
          WarehouseJobStatus.COMPLETED,
          WarehouseJobStatus.CANCELLED,
        ),
      ).toThrow(BadRequestException);
      expect(() =>
        service.assertTransition(
          WarehouseJobStatus.CANCELLED,
          WarehouseJobStatus.OPEN,
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('open/start/complete/cancel', () => {
    it('open transitions DRAFT -> OPEN with STATUS_CHANGED event', async () => {
      const { service, tx, eventsService } = makeService();
      tx.warehouseJob.findFirst.mockResolvedValue(makeJob());
      tx.warehouseJob.update.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.OPEN }),
      );

      await service.open(tenantA, jobId, 'user-1');

      expect(tx.warehouseJob.findFirst).toHaveBeenCalledWith({
        where: { id: jobId, tenantId: tenantA },
      });
      expect(eventsService.append).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: WarehouseJobEventType.STATUS_CHANGED,
          fromStatus: WarehouseJobStatus.DRAFT,
          toStatus: WarehouseJobStatus.OPEN,
        }),
      );
    });

    it('start sets startedAt when empty', async () => {
      const { service, tx } = makeService();
      tx.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.OPEN }),
      );
      tx.warehouseJob.update.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.IN_PROGRESS }),
      );

      await service.start(tenantA, jobId);

      expect(tx.warehouseJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WarehouseJobStatus.IN_PROGRESS,
            startedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('complete sets completedAt', async () => {
      const { service, tx } = makeService();
      tx.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.IN_PROGRESS }),
      );
      tx.warehouseJobLine.findMany.mockResolvedValue([]);
      tx.warehouseJob.update.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.COMPLETED }),
      );

      await service.complete(tenantA, jobId);

      expect(tx.warehouseJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WarehouseJobStatus.COMPLETED,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('manual complete rejects incomplete lines', async () => {
      const { service, tx } = makeService();
      tx.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.IN_PROGRESS }),
      );
      tx.warehouseJobLine.findMany.mockResolvedValue([
        { requestedQty: 5, completedQty: 2 },
      ]);

      await expect(service.complete(tenantA, jobId)).rejects.toThrow(
        'Cannot complete warehouse job until all lines reach requested quantity',
      );
      expect(tx.warehouseJob.update).not.toHaveBeenCalled();
    });

    it('manual complete allows all lines complete', async () => {
      const { service, tx } = makeService();
      tx.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.IN_PROGRESS }),
      );
      tx.warehouseJobLine.findMany.mockResolvedValue([
        { requestedQty: 5, completedQty: 5 },
        { requestedQty: 3, completedQty: 3 },
      ]);
      tx.warehouseJob.update.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.COMPLETED }),
      );

      await service.complete(tenantA, jobId);

      expect(tx.warehouseJob.update).toHaveBeenCalled();
    });

    it('manual complete allows no-line header-only job', async () => {
      const { service, tx } = makeService();
      tx.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.IN_PROGRESS }),
      );
      tx.warehouseJobLine.findMany.mockResolvedValue([]);
      tx.warehouseJob.update.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.COMPLETED }),
      );

      await expect(service.complete(tenantA, jobId)).resolves.toBeDefined();
    });

    it('cancel stores cancelledAt, cancelledReason, and extra CANCELLED event when reason provided', async () => {
      const { service, tx, eventsService } = makeService();
      tx.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.IN_PROGRESS }),
      );
      tx.warehouseJob.update.mockResolvedValue(
        makeJob({
          status: WarehouseJobStatus.CANCELLED,
          cancelledReason: 'No stock',
        }),
      );

      await service.cancel(tenantA, jobId, 'user-1', 'No stock');

      expect(tx.warehouseJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WarehouseJobStatus.CANCELLED,
            cancelledAt: expect.any(Date),
            cancelledReason: 'No stock',
          }),
        }),
      );
      expect(eventsService.append).toHaveBeenCalledTimes(2);
      expect(eventsService.append).toHaveBeenNthCalledWith(
        2,
        tx,
        expect.objectContaining({
          eventType: WarehouseJobEventType.CANCELLED,
          payload: { reason: 'No stock' },
        }),
      );
    });

    it('throws NotFoundException when job missing for tenant', async () => {
      const { service, tx } = makeService();
      tx.warehouseJob.findFirst.mockResolvedValue(null);

      await expect(service.open(tenantA, jobId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('maybeAutoCompleteJob', () => {
    function makeAutoCompleteTx() {
      return {
        warehouseJob: {
          findFirst: jest.fn(),
          update: jest.fn(),
        },
        warehouseJobLine: {
          findMany: jest.fn(),
        },
      };
    }

    it('does nothing when job is not IN_PROGRESS', async () => {
      const { service, eventsService } = makeService();
      const tx = makeAutoCompleteTx();
      tx.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.OPEN }),
      );

      const result = await service.maybeAutoCompleteJob(
        tx as any,
        tenantA,
        jobId,
      );

      expect(result.autoCompleted).toBe(false);
      expect(tx.warehouseJob.update).not.toHaveBeenCalled();
      expect(eventsService.append).not.toHaveBeenCalled();
    });

    it('does nothing when job has no lines', async () => {
      const { service, eventsService } = makeService();
      const tx = makeAutoCompleteTx();
      tx.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.IN_PROGRESS }),
      );
      tx.warehouseJobLine.findMany.mockResolvedValue([]);

      const result = await service.maybeAutoCompleteJob(
        tx as any,
        tenantA,
        jobId,
      );

      expect(result.autoCompleted).toBe(false);
      expect(tx.warehouseJob.update).not.toHaveBeenCalled();
      expect(eventsService.append).not.toHaveBeenCalled();
    });

    it('does nothing when any line is incomplete', async () => {
      const { service, eventsService } = makeService();
      const tx = makeAutoCompleteTx();
      tx.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.IN_PROGRESS }),
      );
      tx.warehouseJobLine.findMany.mockResolvedValue([
        { requestedQty: 5, completedQty: 5 },
        { requestedQty: 3, completedQty: 1 },
      ]);

      const result = await service.maybeAutoCompleteJob(
        tx as any,
        tenantA,
        jobId,
      );

      expect(result.autoCompleted).toBe(false);
      expect(tx.warehouseJob.update).not.toHaveBeenCalled();
      expect(eventsService.append).not.toHaveBeenCalled();
    });

    it('completes IN_PROGRESS job when all lines are complete', async () => {
      const { service, eventsService } = makeService();
      const tx = makeAutoCompleteTx();
      tx.warehouseJob.findFirst.mockResolvedValue({
        id: jobId,
        status: WarehouseJobStatus.IN_PROGRESS,
        completedAt: null,
      });
      tx.warehouseJobLine.findMany.mockResolvedValue([
        { requestedQty: 5, completedQty: 5 },
        { requestedQty: 2, completedQty: 2 },
      ]);
      tx.warehouseJob.update.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.COMPLETED }),
      );

      const result = await service.maybeAutoCompleteJob(
        tx as any,
        tenantA,
        jobId,
        'user-1',
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
    });

    it('requires at least one positive requestedQty line', async () => {
      const { service, eventsService } = makeService();
      const tx = makeAutoCompleteTx();
      tx.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.IN_PROGRESS }),
      );
      tx.warehouseJobLine.findMany.mockResolvedValue([
        { requestedQty: 0, completedQty: 0 },
      ]);

      const result = await service.maybeAutoCompleteJob(
        tx as any,
        tenantA,
        jobId,
      );

      expect(result.autoCompleted).toBe(false);
      expect(tx.warehouseJob.update).not.toHaveBeenCalled();
      expect(eventsService.append).not.toHaveBeenCalled();
    });

    it('writes STATUS_CHANGED event on auto-complete', async () => {
      const { service, eventsService } = makeService();
      const tx = makeAutoCompleteTx();
      tx.warehouseJob.findFirst.mockResolvedValue({
        id: jobId,
        status: WarehouseJobStatus.IN_PROGRESS,
        completedAt: null,
      });
      tx.warehouseJobLine.findMany.mockResolvedValue([
        { requestedQty: 1, completedQty: 1 },
      ]);
      tx.warehouseJob.update.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.COMPLETED }),
      );

      await service.maybeAutoCompleteJob(tx as any, tenantA, jobId, 'user-1');

      expect(eventsService.append).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: WarehouseJobEventType.STATUS_CHANGED,
          fromStatus: WarehouseJobStatus.IN_PROGRESS,
          toStatus: WarehouseJobStatus.COMPLETED,
          actorUserId: 'user-1',
        }),
      );
    });
  });

  describe('terminal statuses', () => {
    it('completed and cancelled jobs remain terminal', () => {
      const { service } = makeService();

      expect(() =>
        service.assertTransition(
          WarehouseJobStatus.COMPLETED,
          WarehouseJobStatus.IN_PROGRESS,
        ),
      ).toThrow(BadRequestException);
      expect(() =>
        service.assertTransition(
          WarehouseJobStatus.CANCELLED,
          WarehouseJobStatus.OPEN,
        ),
      ).toThrow(BadRequestException);
    });
  });
});

import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  WarehouseJobEventType,
  WarehouseJobPriority,
  WarehouseJobStatus,
  WarehouseJobType,
  Role,
  MembershipStatus,
} from '@prisma/client';
import { WarehouseJobEventsService } from './warehouse-job-events.service';
import { WarehouseJobLifecycleService } from './warehouse-job-lifecycle.service';
import { WarehouseJobDocumentsService } from './warehouse-job-documents.service';
import { WarehouseJobCargoLinesService } from './warehouse-job-cargo-lines.service';
import { WarehouseJobDeliveryOrderService } from './warehouse-job-delivery-order.service';
import { WarehouseJobsService } from './warehouse-jobs.service';

describe('WarehouseJobsService', () => {
  const tenantId = 'tenant-1';
  const otherTenantId = 'tenant-2';
  const jobId = 'wh-job-1';
  const actorUserId = 'user-ops';

  function makeJob(overrides: Partial<any> = {}) {
    return {
      id: jobId,
      tenantId,
      internalRef: 'WH-2026-07-0001',
      type: WarehouseJobType.RECEIVE,
      status: WarehouseJobStatus.DRAFT,
      priority: WarehouseJobPriority.NORMAL,
      title: null,
      description: null,
      notes: null,
      customerCompanyId: null,
      inventoryBatchId: null,
      assignedToUserId: null,
      createdByUserId: actorUserId,
      scheduledAt: null,
      externalRefType: null,
      externalRefId: null,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  function makeService() {
    const eventsService = {
      append: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    } as unknown as WarehouseJobEventsService;

    const lifecycleService = {
      allocateInternalRef: jest.fn().mockResolvedValue('WH-2026-07-0001'),
      resolveCreatorInitial: jest.fn().mockResolvedValue('MU'),
      allocateCustomerReference: jest.fn().mockResolvedValue({
        customerReference: 'DB-MU 26KAT#1207',
        customerReferenceSeq: 1207,
        yy: '26',
      }),
      open: jest.fn(),
      start: jest.fn(),
      complete: jest.fn(),
      cancel: jest.fn(),
    } as unknown as WarehouseJobLifecycleService;

    const tx = {
      warehouseJob: {
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const prisma: any = {
      $transaction: jest.fn(async (arg: any) => {
        if (typeof arg === 'function') return arg(tx);
        return Promise.all(arg);
      }),
      warehouseJob: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([makeJob()]),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: 'company-1' }),
      },
      inventory_batches: {
        findFirst: jest.fn().mockResolvedValue({ id: 'batch-1' }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'user-2' }),
      },
      tenantMembership: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ role: Role.WAREHOUSE }),
      },
    };

    const documentsService = {
      countDocumentsByReviewStatus: jest.fn().mockResolvedValue(new Map()),
    } as unknown as WarehouseJobDocumentsService;

    const cargoLinesService = {
      createManyInTransaction: jest.fn().mockResolvedValue([]),
    } as unknown as WarehouseJobCargoLinesService;

    const deliveryOrderService = {
      generate: jest.fn().mockResolvedValue({
        job: makeJob({ deliveryOrderDocumentId: 'doc-1' }),
        document: { id: 'doc-1' },
      }),
    } as unknown as WarehouseJobDeliveryOrderService;

    const service = new WarehouseJobsService(
      prisma,
      lifecycleService,
      eventsService,
      documentsService,
      cargoLinesService,
      deliveryOrderService,
    );

    return {
      service,
      prisma,
      tx,
      lifecycleService,
      eventsService,
      documentsService,
      cargoLinesService,
      deliveryOrderService,
    };
  }

  describe('create', () => {
    it('creates job with internalRef, CREATED event, and tenant scope', async () => {
      const { service, tx, lifecycleService, eventsService } = makeService();
      const created = makeJob();
      tx.warehouseJob.create.mockResolvedValue(created);

      const result = await service.create(
        tenantId,
        { type: WarehouseJobType.RECEIVE, title: 'Inbound' },
        actorUserId,
      );

      expect(lifecycleService.allocateInternalRef).toHaveBeenCalledWith(
        tx,
        tenantId,
      );
      expect(tx.warehouseJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            internalRef: 'WH-2026-07-0001',
            status: WarehouseJobStatus.DRAFT,
            priority: WarehouseJobPriority.NORMAL,
            createdByUserId: actorUserId,
          }),
        }),
      );
      expect(eventsService.append).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: WarehouseJobEventType.CREATED,
          tenantId,
          warehouseJobId: jobId,
        }),
      );
      expect(result).toEqual(created);
    });

    it('rejects lines payload', async () => {
      const { service } = makeService();

      await expect(
        service.create(tenantId, {
          type: WarehouseJobType.PICK,
          lines: [{ requestedQty: 1 }],
        }),
      ).rejects.toThrow('Lines are not implemented yet.');
    });

    it('accepts new business service type STUFFING', async () => {
      const { service, tx } = makeService();
      const created = makeJob({ type: WarehouseJobType.STUFFING });
      tx.warehouseJob.create.mockResolvedValue(created);

      const result = await service.create(
        tenantId,
        { type: WarehouseJobType.STUFFING, title: 'Container stuffing' },
        actorUserId,
      );

      expect(tx.warehouseJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: WarehouseJobType.STUFFING,
          }),
        }),
      );
      expect(result.type).toBe(WarehouseJobType.STUFFING);
    });

    it('allocates customer reference when generateCustomerReference is true', async () => {
      const { service, tx, lifecycleService } = makeService();
      const created = makeJob({
        type: WarehouseJobType.STUFFING,
        customerReference: 'DB-MU 26KAT#1207',
        orderReference: '394-RW265015',
      });
      tx.warehouseJob.create.mockResolvedValue(created);

      await service.create(
        tenantId,
        {
          type: WarehouseJobType.STUFFING,
          title: 'Stuffing job',
          generateCustomerReference: true,
          customerInitial: 'KAT',
          orderReference: '394-RW265015',
        },
        actorUserId,
      );

      expect(lifecycleService.resolveCreatorInitial).toHaveBeenCalled();
      expect(lifecycleService.allocateCustomerReference).toHaveBeenCalledWith(
        tx,
        tenantId,
        'KAT',
        'MU',
      );
      expect(tx.warehouseJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerReference: 'DB-MU 26KAT#1207',
            orderReference: '394-RW265015',
            customerInitial: 'KAT',
            creatorInitial: 'MU',
          }),
        }),
      );
    });

    it('rejects generateCustomerReference without customerInitial', async () => {
      const { service } = makeService();

      await expect(
        service.create(
          tenantId,
          {
            type: WarehouseJobType.STUFFING,
            title: 'Stuffing job',
            generateCustomerReference: true,
          },
          actorUserId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('list', () => {
    it('scopes list by tenantId', async () => {
      const { service, prisma } = makeService();

      await service.list(tenantId, { page: 1, pageSize: 20 });

      expect(prisma.warehouseJob.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ tenantId }),
      });
      expect(prisma.warehouseJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId }),
        }),
      );
    });
  });

  describe('getById', () => {
    it('returns tenant-scoped job', async () => {
      const { service, prisma, documentsService } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue({
        ...makeJob(),
        documents: [],
      });
      documentsService.countDocumentsByReviewStatus = jest.fn().mockResolvedValue(
        new Map([
          [
            jobId,
            {
              totalDocuments: 0,
              pendingReviewDocuments: 0,
              approvedDocuments: 0,
              rejectedDocuments: 0,
            },
          ],
        ]),
      );

      const result = await service.getById(tenantId, jobId);

      expect(result.id).toBe(jobId);
      expect(result.documentCounts.totalDocuments).toBe(0);
    });

    it('throws NotFoundException for other tenant', async () => {
      const { service, prisma } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(null);

      await expect(service.getById(otherTenantId, jobId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('rejects update when status is IN_PROGRESS, COMPLETED, or CANCELLED', async () => {
      const { service, prisma } = makeService();

      for (const status of [
        WarehouseJobStatus.IN_PROGRESS,
        WarehouseJobStatus.COMPLETED,
        WarehouseJobStatus.CANCELLED,
      ]) {
        prisma.warehouseJob.findFirst.mockResolvedValue(makeJob({ status }));
        await expect(
          service.update(tenantId, jobId, { title: 'Updated' }, actorUserId),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('writes ASSIGNED event when assignedToUserId changes', async () => {
      const { service, prisma, tx, eventsService } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(makeJob());
      tx.warehouseJob.update.mockResolvedValue(
        makeJob({ assignedToUserId: 'user-2' }),
      );

      await service.update(
        tenantId,
        jobId,
        { assignedToUserId: 'user-2' },
        actorUserId,
      );

      expect(eventsService.append).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: WarehouseJobEventType.ASSIGNED,
          payload: { assignedToUserId: 'user-2' },
        }),
      );
    });
  });

  describe('lifecycle delegation', () => {
    it('delegates open/start/complete/cancel to lifecycle service', async () => {
      const { service, lifecycleService } = makeService();

      await service.open(tenantId, jobId, actorUserId);
      await service.start(tenantId, jobId, actorUserId);
      await service.complete(tenantId, jobId, actorUserId);
      await service.cancel(tenantId, jobId, actorUserId, 'reason');

      expect(lifecycleService.open).toHaveBeenCalledWith(
        tenantId,
        jobId,
        actorUserId,
      );
      expect(lifecycleService.start).toHaveBeenCalledWith(
        tenantId,
        jobId,
        actorUserId,
      );
      expect(lifecycleService.complete).toHaveBeenCalledWith(
        tenantId,
        jobId,
        actorUserId,
      );
      expect(lifecycleService.cancel).toHaveBeenCalledWith(
        tenantId,
        jobId,
        actorUserId,
        'reason',
      );
    });
  });

  describe('updateExecution', () => {
    it('rejects COMPLETED/CANCELLED jobs', async () => {
      const { service, prisma } = makeService();

      for (const status of [
        WarehouseJobStatus.COMPLETED,
        WarehouseJobStatus.CANCELLED,
      ]) {
        prisma.warehouseJob.findFirst.mockResolvedValue(
          makeJob({ status, assignedToUserId: null }),
        );
        await expect(
          service.updateExecution(
            tenantId,
            jobId,
            { containerNumber: 'CONT-1' },
            actorUserId,
            Role.OPS,
          ),
        ).rejects.toThrow('Cannot update execution');
      }
    });

    it('updates containerNumber, sealNumber, warehouseNotes', async () => {
      const { service, prisma, tx, eventsService } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(
        makeJob({ status: WarehouseJobStatus.IN_PROGRESS }),
      );
      tx.warehouseJob.update.mockResolvedValue(
        makeJob({
          containerNumber: 'CONT-1',
          sealNumber: 'SEAL-1',
          warehouseNotes: 'Floor note',
        }),
      );

      await service.updateExecution(
        tenantId,
        jobId,
        {
          containerNumber: 'CONT-1',
          sealNumber: 'SEAL-1',
          warehouseNotes: 'Floor note',
        },
        actorUserId,
        Role.OPS,
      );

      expect(tx.warehouseJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            containerNumber: 'CONT-1',
            sealNumber: 'SEAL-1',
            warehouseNotes: 'Floor note',
          }),
        }),
      );
      expect(eventsService.append).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: WarehouseJobEventType.EXECUTION_UPDATED,
        }),
      );
    });

    it('WAREHOUSE rejects job assigned to another user', async () => {
      const { service, prisma } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(
        makeJob({
          status: WarehouseJobStatus.IN_PROGRESS,
          assignedToUserId: 'other-user',
        }),
      );

      await expect(
        service.updateExecution(
          tenantId,
          jobId,
          { warehouseNotes: 'n' },
          actorUserId,
          Role.WAREHOUSE,
        ),
      ).rejects.toThrow('assigned to another user');
    });

    it('WAREHOUSE allows unassigned OPEN job', async () => {
      const { service, prisma, tx } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(
        makeJob({
          status: WarehouseJobStatus.OPEN,
          assignedToUserId: null,
        }),
      );
      tx.warehouseJob.update.mockResolvedValue(
        makeJob({ warehouseNotes: 'ok' }),
      );

      await expect(
        service.updateExecution(
          tenantId,
          jobId,
          { warehouseNotes: 'ok' },
          actorUserId,
          Role.WAREHOUSE,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('assignedToUserId validation', () => {
    it('accepts WAREHOUSE assignee on create', async () => {
      const { service, tx, prisma } = makeService();
      prisma.tenantMembership.findFirst.mockResolvedValue({ role: Role.WAREHOUSE });
      tx.warehouseJob.create.mockResolvedValue(makeJob({ assignedToUserId: 'user-wh' }));

      await service.create(
        tenantId,
        {
          type: WarehouseJobType.STUFFING,
          title: 'Stuffing',
          assignedToUserId: 'user-wh',
        },
        actorUserId,
      );

      expect(prisma.tenantMembership.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            userId: 'user-wh',
            status: MembershipStatus.Active,
          }),
        }),
      );
    });

    it('accepts OPS and ADMIN assignees on update', async () => {
      const { service, prisma, tx } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(makeJob());
      prisma.tenantMembership.findFirst.mockResolvedValue({ role: Role.OPS });
      tx.warehouseJob.update.mockResolvedValue(makeJob({ assignedToUserId: 'user-ops' }));

      await service.update(tenantId, jobId, { assignedToUserId: 'user-ops' }, actorUserId);

      prisma.tenantMembership.findFirst.mockResolvedValue({ role: Role.ADMIN });
      tx.warehouseJob.update.mockResolvedValue(makeJob({ assignedToUserId: 'user-admin' }));
      await service.update(tenantId, jobId, { assignedToUserId: 'user-admin' }, actorUserId);
    });

    it.each([Role.DRIVER, Role.CUSTOMER, Role.FINANCE])(
      'rejects %s assignee',
      async (role) => {
        const { service, tx, prisma } = makeService();
        prisma.tenantMembership.findFirst.mockResolvedValue({ role });

        await expect(
          service.create(
            tenantId,
            {
              type: WarehouseJobType.STUFFING,
              title: 'Stuffing',
              assignedToUserId: 'user-bad',
            },
            actorUserId,
          ),
        ).rejects.toThrow('Assigned user must be a warehouse, ops, or admin user.');
        expect(tx.warehouseJob.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('listWarehousingUsers', () => {
    it('returns only OPS and WAREHOUSE memberships', async () => {
      const { service, prisma } = makeService();
      prisma.tenantMembership.count.mockResolvedValue(1);
      prisma.tenantMembership.findMany.mockResolvedValue([
        {
          id: 'm-wh',
          role: Role.WAREHOUSE,
          status: MembershipStatus.Active,
          user: {
            id: 'u-wh',
            email: 'wh@example.com',
            name: 'Warehouse',
            phone: null,
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
            updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          },
        },
      ]);

      const result = await service.listWarehousingUsers(tenantId, { page: 1, pageSize: 25 });

      expect(prisma.tenantMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            role: { in: [Role.OPS, Role.WAREHOUSE] },
          }),
        }),
      );
      expect(result.data[0]?.role).toBe(Role.WAREHOUSE);
    });
  });
});

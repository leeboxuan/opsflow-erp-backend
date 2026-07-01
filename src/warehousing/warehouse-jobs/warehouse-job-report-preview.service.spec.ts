import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  Role,
  WarehouseJobDocumentReviewStatus,
  WarehouseJobDocumentSource,
  WarehouseJobDocumentType,
  WarehouseJobStatus,
  WarehouseJobType,
} from '@prisma/client';
import { WarehouseJobReportPreviewService } from './warehouse-job-report-preview.service';

jest.mock('./warehouse-job-document-storage', () => ({
  createWarehouseJobDocumentSignedUrl: jest
    .fn()
    .mockResolvedValue('https://signed.example/doc'),
}));

describe('WarehouseJobReportPreviewService', () => {
  const tenantId = 'tenant-1';
  const warehouseJobId = 'job-1';
  const actorUserId = 'user-wh';

  function makeJob(overrides: Partial<any> = {}) {
    return {
      id: warehouseJobId,
      tenantId,
      internalRef: 'WJ-001',
      type: WarehouseJobType.RECEIVE,
      status: WarehouseJobStatus.COMPLETED,
      priority: 'NORMAL',
      title: 'Receive batch',
      description: null,
      notes: 'Admin notes',
      containerNumber: 'CONT-123',
      sealNumber: 'SEAL-1',
      warehouseNotes: 'Floor notes',
      scheduledAt: null,
      startedAt: new Date('2026-07-01T08:00:00Z'),
      completedAt: new Date('2026-07-01T10:00:00Z'),
      cancelledAt: null,
      createdAt: new Date('2026-07-01T07:00:00Z'),
      updatedAt: new Date('2026-07-01T10:00:00Z'),
      assignedToUserId: actorUserId,
      customerCompany: { id: 'cc-1', name: 'Acme' },
      inventoryBatch: { id: 'batch-1', containerNumber: 'B-1', batchDescription: null },
      assignedToUser: { id: actorUserId, name: 'Worker', email: 'w@example.com' },
      createdByUser: { id: 'ops-1', name: 'Ops', email: 'ops@example.com' },
      events: [],
      _count: { lines: 1, units: 1 },
      lines: [{ requestedQty: 5, completedQty: 5 }],
      units: [{ linkStatus: 'CONFIRMED' }],
      documents: [
        {
          id: 'doc-pl',
          type: WarehouseJobDocumentType.PACKING_LIST,
          source: WarehouseJobDocumentSource.OPS,
          reviewStatus: WarehouseJobDocumentReviewStatus.APPROVED,
          originalName: 'packing.pdf',
          fileName: 'packing.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1000,
          storageKey: 'tenant/job/packing.pdf',
          url: null,
          notes: null,
          rejectedReason: null,
          uploadedByUser: { id: 'ops-1', name: 'Ops', email: 'ops@example.com' },
          reviewedByUser: { id: 'ops-1', name: 'Ops', email: 'ops@example.com' },
          reviewedAt: new Date('2026-07-01T09:00:00Z'),
          createdAt: new Date('2026-07-01T08:30:00Z'),
        },
        {
          id: 'doc-photo',
          type: WarehouseJobDocumentType.WAREHOUSE_PHOTO,
          source: WarehouseJobDocumentSource.WAREHOUSE,
          reviewStatus: WarehouseJobDocumentReviewStatus.APPROVED,
          originalName: 'floor.jpg',
          fileName: 'floor.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 2000,
          storageKey: 'tenant/job/floor.jpg',
          url: null,
          notes: null,
          rejectedReason: null,
          uploadedByUser: { id: actorUserId, name: 'Worker', email: 'w@example.com' },
          reviewedByUser: { id: 'ops-1', name: 'Ops', email: 'ops@example.com' },
          reviewedAt: new Date('2026-07-01T09:30:00Z'),
          createdAt: new Date('2026-07-01T09:00:00Z'),
        },
      ],
      ...overrides,
    };
  }

  function makeService(job: any = makeJob()) {
    const prisma: any = {
      warehouseJob: {
        findFirst: jest.fn().mockResolvedValue(job),
      },
      inventory_units: { update: jest.fn(), updateMany: jest.fn() },
      transport_order_items: { update: jest.fn(), updateMany: jest.fn() },
    };

    const supabaseService = { getClient: jest.fn() };

    const service = new WarehouseJobReportPreviewService(
      prisma,
      supabaseService as any,
    );

    return { service, prisma, supabaseService };
  }

  it('returns tenant-scoped job preview', async () => {
    const { service, prisma } = makeService();

    const result = await service.getReportPreview(
      tenantId,
      { role: Role.ADMIN, userId: 'admin-1' },
      warehouseJobId,
    );

    expect(prisma.warehouseJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: warehouseJobId, tenantId },
      }),
    );
    expect(result.job.id).toBe(warehouseJobId);
    expect(result.job.containerNumber).toBe('CONT-123');
    expect(result.generatedAt).toBeInstanceOf(Date);
  });

  it('applies WAREHOUSE access policy for assigned job', async () => {
    const { service } = makeService();

    await expect(
      service.getReportPreview(
        tenantId,
        { role: Role.WAREHOUSE, userId: actorUserId },
        warehouseJobId,
      ),
    ).resolves.toBeDefined();
  });

  it('rejects WAREHOUSE access to inaccessible job', async () => {
    const { service } = makeService(
      makeJob({
        assignedToUserId: 'other-user',
        status: WarehouseJobStatus.COMPLETED,
      }),
    );

    await expect(
      service.getReportPreview(
        tenantId,
        { role: Role.WAREHOUSE, userId: actorUserId },
        warehouseJobId,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('includes execution fields', async () => {
    const { service } = makeService();

    const result = await service.getReportPreview(
      tenantId,
      { role: Role.OPS, userId: 'ops-1' },
      warehouseJobId,
    );

    expect(result.job.containerNumber).toBe('CONT-123');
    expect(result.job.sealNumber).toBe('SEAL-1');
    expect(result.job.warehouseNotes).toBe('Floor notes');
  });

  it('groups documents by type', async () => {
    const { service } = makeService();

    const result = await service.getReportPreview(
      tenantId,
      { role: Role.FINANCE, userId: 'fin-1' },
      warehouseJobId,
    );

    expect(result.documents.packingLists).toHaveLength(1);
    expect(result.documents.warehousePhotos).toHaveLength(1);
    expect(result.documents.byType[WarehouseJobDocumentType.PACKING_LIST]).toHaveLength(
      1,
    );
  });

  it('groups and counts documents by reviewStatus', async () => {
    const { service } = makeService();

    const result = await service.getReportPreview(
      tenantId,
      { role: Role.ADMIN, userId: 'admin-1' },
      warehouseJobId,
    );

    expect(result.documents.byReviewStatus.APPROVED).toHaveLength(2);
    expect(result.readiness.approvedDocuments).toBe(2);
    expect(result.readiness.pendingReviewDocuments).toBe(0);
  });

  it('readyForReport true when criteria met', async () => {
    const { service } = makeService();

    const result = await service.getReportPreview(
      tenantId,
      { role: Role.ADMIN, userId: 'admin-1' },
      warehouseJobId,
    );

    expect(result.readiness.readyForReport).toBe(true);
    expect(result.readiness.blockers).toEqual([]);
  });

  it('readyForReport false with blockers when job incomplete', async () => {
    const { service } = makeService(
      makeJob({ status: WarehouseJobStatus.IN_PROGRESS }),
    );

    const result = await service.getReportPreview(
      tenantId,
      { role: Role.ADMIN, userId: 'admin-1' },
      warehouseJobId,
    );

    expect(result.readiness.readyForReport).toBe(false);
    expect(result.readiness.blockers.map((b) => b.code)).toContain(
      'JOB_NOT_COMPLETED',
    );
  });

  it('blockers include correct codes', async () => {
    const { service } = makeService(
      makeJob({
        status: WarehouseJobStatus.IN_PROGRESS,
        containerNumber: null,
        sealNumber: null,
        warehouseNotes: null,
        documents: [],
      }),
    );

    const result = await service.getReportPreview(
      tenantId,
      { role: Role.ADMIN, userId: 'admin-1' },
      warehouseJobId,
    );

    const codes = result.readiness.blockers.map((b) => b.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'JOB_NOT_COMPLETED',
        'NO_DOCUMENTS',
        'MISSING_EXECUTION_DETAILS',
        'MISSING_WAREHOUSE_OR_COMPLETION_PHOTO',
      ]),
    );
  });

  it('does not expose storageKey in documents', async () => {
    const { service } = makeService();

    const result = await service.getReportPreview(
      tenantId,
      { role: Role.ADMIN, userId: 'admin-1' },
      warehouseJobId,
    );

    for (const doc of result.documents.all) {
      expect(doc).not.toHaveProperty('storageKey');
    }
  });

  it('throws NotFoundException when job missing', async () => {
    const { service, prisma } = makeService();
    prisma.warehouseJob.findFirst.mockResolvedValue(null);

    await expect(
      service.getReportPreview(
        tenantId,
        { role: Role.ADMIN, userId: 'admin-1' },
        warehouseJobId,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('no inventory_units update calls', async () => {
    const { service, prisma } = makeService();

    await service.getReportPreview(
      tenantId,
      { role: Role.ADMIN, userId: 'admin-1' },
      warehouseJobId,
    );

    expect(prisma.inventory_units.update).not.toHaveBeenCalled();
    expect(prisma.inventory_units.updateMany).not.toHaveBeenCalled();
  });

  it('no transport models touched', async () => {
    const { service, prisma } = makeService();

    await service.getReportPreview(
      tenantId,
      { role: Role.ADMIN, userId: 'admin-1' },
      warehouseJobId,
    );

    expect(prisma.transport_order_items.update).not.toHaveBeenCalled();
    expect(prisma.transport_order_items.updateMany).not.toHaveBeenCalled();
  });
});

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  Role,
  WarehouseJobDocumentReviewStatus,
  WarehouseJobDocumentSource,
  WarehouseJobDocumentType,
  WarehouseJobEventType,
  WarehouseJobStatus,
} from '@prisma/client';
import { WarehouseJobEventsService } from './warehouse-job-events.service';
import { WarehouseJobDocumentsService } from './warehouse-job-documents.service';

jest.mock('./warehouse-job-document-storage', () => ({
  assertAllowedWarehouseJobDocumentFile: jest.fn(),
  buildWarehouseJobDocumentStorageKey: jest
    .fn()
    .mockReturnValue('tenant/warehouse-jobs/job/doc/key.pdf'),
  createWarehouseJobDocumentSignedUrl: jest
    .fn()
    .mockResolvedValue('https://signed.example/doc'),
  uploadWarehouseJobDocument: jest.fn().mockResolvedValue(undefined),
}));

describe('WarehouseJobDocumentsService', () => {
  const tenantId = 'tenant-1';
  const warehouseJobId = 'job-1';
  const documentId = 'doc-1';
  const actorUserId = 'user-wh';

  function makeJob(overrides: Partial<any> = {}) {
    return {
      id: warehouseJobId,
      status: WarehouseJobStatus.OPEN,
      assignedToUserId: actorUserId,
      ...overrides,
    };
  }

  function makeDocument(overrides: Partial<any> = {}) {
    return {
      id: documentId,
      tenantId,
      warehouseJobId,
      type: WarehouseJobDocumentType.WAREHOUSE_PHOTO,
      source: WarehouseJobDocumentSource.WAREHOUSE,
      reviewStatus: WarehouseJobDocumentReviewStatus.PENDING_REVIEW,
      storageKey: 'key',
      url: null,
      uploadedByUser: null,
      reviewedByUser: null,
      ...overrides,
    };
  }

  function makeFile(overrides: Partial<Express.Multer.File> = {}) {
    return {
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      size: 1000,
      buffer: Buffer.from('abc'),
      ...overrides,
    } as Express.Multer.File;
  }

  function makeService() {
    const eventsService = {
      append: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    } as unknown as WarehouseJobEventsService;

    const supabaseService = {
      getClient: jest.fn(),
    };

    const tx = {
      warehouseJobDocument: {
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      warehouseJob: {
        findFirst: jest.fn().mockResolvedValue(makeJob()),
      },
      warehouseJobDocument: {
        findMany: jest.fn().mockResolvedValue([makeDocument()]),
        findFirst: jest.fn().mockResolvedValue(makeDocument()),
        delete: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      transport_order_items: { update: jest.fn(), updateMany: jest.fn() },
      inventory_units: { update: jest.fn(), updateMany: jest.fn() },
    };

    const service = new WarehouseJobDocumentsService(
      prisma,
      supabaseService as any,
      eventsService,
    );

    return { service, prisma, tx, eventsService, supabaseService };
  }

  describe('list', () => {
    it('is tenant-scoped', async () => {
      const { service, prisma } = makeService();

      await service.list(tenantId, warehouseJobId, Role.ADMIN, actorUserId);

      expect(prisma.warehouseJobDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, warehouseJobId },
        }),
      );
    });
  });

  describe('upload', () => {
    it('validates parent job tenant', async () => {
      const { service, prisma } = makeService();
      prisma.warehouseJob.findFirst.mockResolvedValue(null);

      await expect(
        service.upload(
          tenantId,
          warehouseJobId,
          WarehouseJobDocumentType.OTHER,
          makeFile(),
          Role.ADMIN,
          actorUserId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('stores metadata', async () => {
      const { service, tx, eventsService } = makeService();
      tx.warehouseJobDocument.create.mockResolvedValue(makeDocument());

      const result = await service.upload(
        tenantId,
        warehouseJobId,
        WarehouseJobDocumentType.PACKING_LIST,
        makeFile({ originalname: 'packing.pdf', mimetype: 'application/pdf' }),
        Role.ADMIN,
        actorUserId,
        'notes',
      );

      expect(tx.warehouseJobDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            warehouseJobId,
            type: WarehouseJobDocumentType.PACKING_LIST,
            source: WarehouseJobDocumentSource.ADMIN,
            originalName: 'packing.pdf',
            storageKey: expect.any(String),
          }),
        }),
      );
      expect(eventsService.append).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: WarehouseJobEventType.DOCUMENT_UPLOADED,
        }),
      );
      expect(result.url).toBe('https://signed.example/doc');
    });

    it('WAREHOUSE rejects PACKING_LIST / DELIVERY_ORDER / INSTRUCTION', async () => {
      const { service } = makeService();

      for (const type of [
        WarehouseJobDocumentType.PACKING_LIST,
        WarehouseJobDocumentType.DELIVERY_ORDER,
        WarehouseJobDocumentType.INSTRUCTION,
      ]) {
        await expect(
          service.upload(
            tenantId,
            warehouseJobId,
            type,
            makeFile(),
            Role.WAREHOUSE,
            actorUserId,
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
    });

    it('WAREHOUSE accepts floor photo types', async () => {
      const { service, tx } = makeService();
      tx.warehouseJobDocument.create.mockResolvedValue(makeDocument());

      for (const type of [
        WarehouseJobDocumentType.WAREHOUSE_PHOTO,
        WarehouseJobDocumentType.DAMAGE_PHOTO,
        WarehouseJobDocumentType.COMPLETION_PHOTO,
        WarehouseJobDocumentType.OTHER,
      ]) {
        await expect(
          service.upload(
            tenantId,
            warehouseJobId,
            type,
            makeFile(),
            Role.WAREHOUSE,
            actorUserId,
          ),
        ).resolves.toBeDefined();
      }
    });
  });

  describe('approve/reject/delete', () => {
    it('approve sets APPROVED, reviewedByUserId, reviewedAt', async () => {
      const { service, tx } = makeService();
      tx.warehouseJobDocument.update.mockResolvedValue(
        makeDocument({
          reviewStatus: WarehouseJobDocumentReviewStatus.APPROVED,
        }),
      );

      await service.approve(
        tenantId,
        warehouseJobId,
        documentId,
        actorUserId,
      );

      expect(tx.warehouseJobDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reviewStatus: WarehouseJobDocumentReviewStatus.APPROVED,
            reviewedByUserId: actorUserId,
            reviewedAt: expect.any(Date),
            rejectedReason: null,
          }),
        }),
      );
    });

    it('reject sets REJECTED, rejectedReason, reviewedByUserId, reviewedAt', async () => {
      const { service, tx } = makeService();
      tx.warehouseJobDocument.update.mockResolvedValue(
        makeDocument({
          reviewStatus: WarehouseJobDocumentReviewStatus.REJECTED,
        }),
      );

      await service.reject(
        tenantId,
        warehouseJobId,
        documentId,
        { reason: 'Blurry photo' },
        actorUserId,
      );

      expect(tx.warehouseJobDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reviewStatus: WarehouseJobDocumentReviewStatus.REJECTED,
            rejectedReason: 'Blurry photo',
            reviewedByUserId: actorUserId,
            reviewedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('delete validates document belongs to job + tenant', async () => {
      const { service, prisma } = makeService();
      prisma.warehouseJobDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.delete(tenantId, warehouseJobId, documentId, actorUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not touch transport or inventory models', async () => {
      const { service, prisma, tx } = makeService();
      tx.warehouseJobDocument.update.mockResolvedValue(makeDocument());

      await service.approve(tenantId, warehouseJobId, documentId, actorUserId);

      expect(prisma.transport_order_items.update).not.toHaveBeenCalled();
      expect(prisma.inventory_units.update).not.toHaveBeenCalled();
    });
  });
});

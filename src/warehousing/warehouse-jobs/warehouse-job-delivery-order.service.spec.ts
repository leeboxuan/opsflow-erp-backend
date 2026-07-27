import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Role,
  WarehouseJobDocumentType,
  WarehouseJobStatus,
  WarehouseJobType,
} from '@prisma/client';
import { WarehouseJobDeliveryOrderService } from './warehouse-job-delivery-order.service';
import { WarehouseJobEventsService } from './warehouse-job-events.service';

jest.mock('./warehouse-job-document-storage', () => ({
  buildWarehouseJobDocumentStorageKey: jest
    .fn()
    .mockReturnValue('tenant/job/delivery_order/file.pdf'),
  uploadWarehouseJobDocumentBuffer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./warehouse-job-delivery-order-pdf', () => ({
  buildWarehouseDeliveryOrderPdf: jest.fn().mockReturnValue(Buffer.from('%PDF-1.4 mock')),
}));

describe('WarehouseJobDeliveryOrderService', () => {
  const tenantId = 'tenant-1';
  const jobId = 'job-1';

  function makeJob(overrides: Partial<any> = {}) {
    return {
      id: jobId,
      tenantId,
      internalRef: 'WH-2026-07-0001',
      type: WarehouseJobType.STUFFING,
      status: WarehouseJobStatus.DRAFT,
      customerReference: 'DB-MU 26KAT#1207',
      orderReference: '394-RW265015',
      receivingVessel: 'MV TEST',
      placeOfDelivery: 'Warehouse A',
      destinationCountry: 'Singapore',
      arrivalDate: new Date('2026-07-02T00:00:00.000Z'),
      departureDate: null,
      containerNumber: null,
      sealNumber: null,
      deliveryOrderDocumentId: null,
      cargoLines: [
        {
          id: 'cargo-1',
          description: 'Cartons',
          quantity: 10,
          totalWeightKg: 120.5,
          lengthCm: 100,
          widthCm: 80,
          heightCm: 60,
          vesselName: 'MV TEST',
          poNumber: '394-RW265015',
          sortOrder: 0,
        },
      ],
      ...overrides,
    };
  }

  function makeService() {
    const eventsService = {
      append: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    } as unknown as WarehouseJobEventsService;

    const tx = {
      warehouseJobDocument: {
        create: jest.fn().mockResolvedValue({
          id: 'doc-1',
          type: WarehouseJobDocumentType.DELIVERY_ORDER,
        }),
      },
      warehouseJob: {
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve(makeJob({ ...data, deliveryOrderDocumentId: 'doc-1' })),
        ),
      },
    };

    const prisma: any = {
      warehouseJob: {
        findFirst: jest.fn().mockResolvedValue(makeJob()),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };

    const supabaseService: any = {
      getClient: jest.fn(),
    };

    const service = new WarehouseJobDeliveryOrderService(
      prisma,
      supabaseService,
      eventsService,
    );

    return { service, prisma, tx, eventsService };
  }

  it('generates delivery order document and links it to the job', async () => {
    const { service, tx } = makeService();

    const result = await service.generate(tenantId, jobId, 'user-1', Role.TRANSPORT_STAFF);

    expect(result.document.id).toBe('doc-1');
    expect(result.job.deliveryOrderDocumentId).toBe('doc-1');
    expect(tx.warehouseJobDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: WarehouseJobDocumentType.DELIVERY_ORDER,
          mimeType: 'application/pdf',
        }),
      }),
    );
    expect(tx.warehouseJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryOrderDocumentId: 'doc-1',
          generateDeliveryOrder: true,
        }),
      }),
    );
  });

  it('rejects when job is missing', async () => {
    const { service, prisma } = makeService();
    prisma.warehouseJob.findFirst.mockResolvedValue(null);

    await expect(service.generate(tenantId, jobId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects when delivery order already generated', async () => {
    const { service, prisma } = makeService();
    prisma.warehouseJob.findFirst.mockResolvedValue(
      makeJob({ deliveryOrderDocumentId: 'doc-existing' }),
    );

    await expect(service.generate(tenantId, jobId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WarehouseJobStatus } from '@prisma/client';
import { WarehouseJobCargoLinesService } from './warehouse-job-cargo-lines.service';

describe('WarehouseJobCargoLinesService', () => {
  const tenantId = 'tenant-1';
  const jobId = 'job-1';

  function makeService() {
    const prisma: any = {
      warehouseJob: {
        findFirst: jest.fn().mockResolvedValue({
          id: jobId,
          status: WarehouseJobStatus.DRAFT,
        }),
      },
      warehouseJobCargoLine: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };

    return { service: new WarehouseJobCargoLinesService(prisma), prisma };
  }

  it('lists cargo lines for a job', async () => {
    const { service, prisma } = makeService();
    prisma.warehouseJobCargoLine.findMany.mockResolvedValue([
      { id: 'line-1', description: 'Cartons' },
    ]);

    const rows = await service.list(tenantId, jobId);
    expect(rows).toHaveLength(1);
    expect(prisma.warehouseJobCargoLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, warehouseJobId: jobId },
      }),
    );
  });

  it('creates a cargo line on a mutable job', async () => {
    const { service, prisma } = makeService();
    prisma.warehouseJobCargoLine.create.mockResolvedValue({
      id: 'line-1',
      description: 'Cartons',
      quantity: 10,
    });

    const row = await service.create(tenantId, jobId, {
      description: 'Cartons',
      quantity: 10,
      poNumber: '394-RW265015',
    });

    expect(row.description).toBe('Cartons');
    expect(prisma.warehouseJobCargoLine.create).toHaveBeenCalled();
  });

  it('rejects create when job is not found', async () => {
    const { service, prisma } = makeService();
    prisma.warehouseJob.findFirst.mockResolvedValue(null);

    await expect(
      service.create(tenantId, jobId, { description: 'Cartons' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects create when job is not mutable', async () => {
    const { service, prisma } = makeService();
    prisma.warehouseJob.findFirst.mockResolvedValue({
      id: jobId,
      status: WarehouseJobStatus.COMPLETED,
    });

    await expect(
      service.create(tenantId, jobId, { description: 'Cartons' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

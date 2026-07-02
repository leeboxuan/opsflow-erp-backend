import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WarehouseJobStatus } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateWarehouseJobCargoLineDto } from './dto/create-warehouse-job-cargo-line.dto';
import { UpdateWarehouseJobCargoLineDto } from './dto/update-warehouse-job-cargo-line.dto';

const MUTABLE_JOB_STATUSES = new Set<WarehouseJobStatus>([
  WarehouseJobStatus.DRAFT,
  WarehouseJobStatus.OPEN,
]);

@Injectable()
export class WarehouseJobCargoLinesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, warehouseJobId: string) {
    await this.findParentJobOrThrow(tenantId, warehouseJobId);

    return this.prisma.warehouseJobCargoLine.findMany({
      where: { tenantId, warehouseJobId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createManyInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseJobId: string,
    lines: CreateWarehouseJobCargoLineDto[],
  ) {
    if (!lines.length) return [];

    const created = [];
    let sortBase = await this.nextSortOrder(tx, tenantId, warehouseJobId);

    for (const [index, dto] of lines.entries()) {
      const description = dto.description?.trim();
      if (!description) {
        throw new BadRequestException('Cargo line description is required');
      }

      const sortOrder = dto.sortOrder ?? sortBase + index;
      const line = await tx.warehouseJobCargoLine.create({
        data: {
          tenantId,
          warehouseJobId,
          description,
          vesselName: dto.vesselName?.trim() || null,
          poNumber: dto.poNumber?.trim() || null,
          quantity: dto.quantity ?? 0,
          totalWeightKg: dto.totalWeightKg ?? null,
          lengthCm: dto.lengthCm ?? null,
          widthCm: dto.widthCm ?? null,
          heightCm: dto.heightCm ?? null,
          unitType: dto.unitType?.trim() || null,
          sortOrder,
        },
      });
      created.push(line);
    }

    return created;
  }

  async create(
    tenantId: string,
    warehouseJobId: string,
    dto: CreateWarehouseJobCargoLineDto,
  ) {
    await this.assertParentJobMutable(tenantId, warehouseJobId);

    const description = dto.description?.trim();
    if (!description) {
      throw new BadRequestException('Cargo line description is required');
    }

    return this.prisma.$transaction(async (tx) => {
      const sortOrder =
        dto.sortOrder ??
        (await this.nextSortOrder(tx, tenantId, warehouseJobId));

      return tx.warehouseJobCargoLine.create({
        data: {
          tenantId,
          warehouseJobId,
          description,
          vesselName: dto.vesselName?.trim() || null,
          poNumber: dto.poNumber?.trim() || null,
          quantity: dto.quantity ?? 0,
          totalWeightKg: dto.totalWeightKg ?? null,
          lengthCm: dto.lengthCm ?? null,
          widthCm: dto.widthCm ?? null,
          heightCm: dto.heightCm ?? null,
          unitType: dto.unitType?.trim() || null,
          sortOrder,
        },
      });
    });
  }

  async update(
    tenantId: string,
    warehouseJobId: string,
    lineId: string,
    dto: UpdateWarehouseJobCargoLineDto,
  ) {
    await this.assertParentJobMutable(tenantId, warehouseJobId);
    const existing = await this.findLineOrThrow(tenantId, warehouseJobId, lineId);

    if (dto.description !== undefined && !dto.description.trim()) {
      throw new BadRequestException('Cargo line description is required');
    }

    const data: Prisma.WarehouseJobCargoLineUpdateInput = {};
    if (dto.description !== undefined) data.description = dto.description.trim();
    if (dto.vesselName !== undefined) data.vesselName = dto.vesselName.trim() || null;
    if (dto.poNumber !== undefined) data.poNumber = dto.poNumber.trim() || null;
    if (dto.quantity !== undefined) data.quantity = dto.quantity;
    if (dto.totalWeightKg !== undefined) data.totalWeightKg = dto.totalWeightKg;
    if (dto.lengthCm !== undefined) data.lengthCm = dto.lengthCm;
    if (dto.widthCm !== undefined) data.widthCm = dto.widthCm;
    if (dto.heightCm !== undefined) data.heightCm = dto.heightCm;
    if (dto.unitType !== undefined) data.unitType = dto.unitType.trim() || null;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    return this.prisma.warehouseJobCargoLine.update({
      where: { id: existing.id },
      data,
    });
  }

  async delete(tenantId: string, warehouseJobId: string, lineId: string) {
    await this.assertParentJobMutable(tenantId, warehouseJobId);
    const existing = await this.findLineOrThrow(tenantId, warehouseJobId, lineId);

    await this.prisma.warehouseJobCargoLine.delete({ where: { id: existing.id } });
    return { deleted: true, lineId: existing.id };
  }

  private async findParentJobOrThrow(tenantId: string, warehouseJobId: string) {
    const job = await this.prisma.warehouseJob.findFirst({
      where: { id: warehouseJobId, tenantId },
      select: { id: true, status: true },
    });

    if (!job) {
      throw new NotFoundException('Warehouse job not found');
    }

    return job;
  }

  private async assertParentJobMutable(tenantId: string, warehouseJobId: string) {
    const job = await this.findParentJobOrThrow(tenantId, warehouseJobId);

    if (!MUTABLE_JOB_STATUSES.has(job.status)) {
      throw new BadRequestException(
        `Cannot modify cargo lines when warehouse job status is ${job.status}`,
      );
    }
  }

  private async findLineOrThrow(
    tenantId: string,
    warehouseJobId: string,
    lineId: string,
  ) {
    const line = await this.prisma.warehouseJobCargoLine.findFirst({
      where: { id: lineId, warehouseJobId, tenantId },
    });

    if (!line) {
      throw new NotFoundException('Warehouse job cargo line not found');
    }

    return line;
  }

  private async nextSortOrder(
    client: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    warehouseJobId: string,
  ) {
    const agg = await client.warehouseJobCargoLine.aggregate({
      where: { tenantId, warehouseJobId },
      _max: { sortOrder: true },
    });

    return (agg._max.sortOrder ?? -1) + 1;
  }
}

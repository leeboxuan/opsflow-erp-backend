import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WarehouseJobEventType,
  WarehouseJobStatus,
  WarehouseJobUnitLinkStatus,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { WarehouseJobEventsService } from './warehouse-job-events.service';
import { WarehouseInventoryBridgeService } from './warehouse-inventory-bridge.service';
import { CreateWarehouseJobLineDto } from './dto/create-warehouse-job-line.dto';
import { UpdateWarehouseJobLineDto } from './dto/update-warehouse-job-line.dto';

const MUTABLE_JOB_STATUSES = new Set<WarehouseJobStatus>([
  WarehouseJobStatus.DRAFT,
  WarehouseJobStatus.OPEN,
]);

const lineListInclude = {
  inventoryItem: {
    select: { id: true, sku: true, name: true, reference: true },
  },
  inventoryBatch: {
    select: { id: true, containerNumber: true, batchDescription: true },
  },
  _count: { select: { units: true } },
} satisfies Prisma.WarehouseJobLineInclude;

type LineWithIncludes = Prisma.WarehouseJobLineGetPayload<{
  include: typeof lineListInclude;
}>;

@Injectable()
export class WarehouseJobLinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: WarehouseJobEventsService,
    private readonly inventoryBridge: WarehouseInventoryBridgeService,
  ) {}

  async list(tenantId: string, warehouseJobId: string) {
    await this.findParentJobOrThrow(tenantId, warehouseJobId);

    const lines = await this.prisma.warehouseJobLine.findMany({
      where: { tenantId, warehouseJobId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: lineListInclude,
    });

    const unitCountsByLine = await this.loadUnitCountsByLine(
      tenantId,
      warehouseJobId,
      lines.map((line) => line.id),
    );

    return lines.map((line) =>
      this.toLineResponse(line, unitCountsByLine.get(line.id)),
    );
  }

  async create(
    tenantId: string,
    warehouseJobId: string,
    dto: CreateWarehouseJobLineDto,
    actorUserId?: string,
  ) {
    await this.assertParentJobMutable(tenantId, warehouseJobId);
    await this.inventoryBridge.assertInventoryItemBelongsToTenant(
      tenantId,
      dto.inventoryItemId,
    );
    await this.inventoryBridge.assertInventoryBatchBelongsToTenant(
      tenantId,
      dto.inventoryBatchId,
    );
    this.assertLineIdentity(
      dto.inventoryItemId,
      dto.inventoryBatchId,
      dto.description,
    );
    if (dto.inventoryItemId && dto.inventoryBatchId) {
      await this.inventoryBridge.assertItemBelongsToBatch(
        tenantId,
        dto.inventoryItemId,
        dto.inventoryBatchId,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const sortOrder =
        dto.sortOrder ??
        (await this.nextSortOrder(tx, tenantId, warehouseJobId));

      const line = await tx.warehouseJobLine.create({
        data: {
          tenantId,
          warehouseJobId,
          inventoryItemId: dto.inventoryItemId ?? null,
          inventoryBatchId: dto.inventoryBatchId ?? null,
          description: dto.description?.trim() || null,
          requestedQty: dto.requestedQty,
          completedQty: 0,
          sortOrder,
          notes: dto.notes?.trim() || null,
        },
        include: lineListInclude,
      });

      await this.eventsService.append(tx, {
        tenantId,
        warehouseJobId,
        actorUserId,
        eventType: WarehouseJobEventType.LINE_ADDED,
        payload: {
          lineId: line.id,
          inventoryItemId: line.inventoryItemId,
          inventoryBatchId: line.inventoryBatchId,
          requestedQty: line.requestedQty,
          sortOrder: line.sortOrder,
        },
      });

      return this.toLineResponse(line);
    });
  }

  async update(
    tenantId: string,
    warehouseJobId: string,
    lineId: string,
    dto: UpdateWarehouseJobLineDto,
    actorUserId?: string,
  ) {
    await this.assertParentJobMutable(tenantId, warehouseJobId);
    const existing = await this.findLineOrThrow(tenantId, warehouseJobId, lineId);

    if (dto.inventoryItemId !== undefined) {
      await this.inventoryBridge.assertInventoryItemBelongsToTenant(
        tenantId,
        dto.inventoryItemId,
      );
    }
    if (dto.inventoryBatchId !== undefined) {
      await this.inventoryBridge.assertInventoryBatchBelongsToTenant(
        tenantId,
        dto.inventoryBatchId,
      );
    }

    const nextInventoryItemId =
      dto.inventoryItemId !== undefined
        ? dto.inventoryItemId ?? null
        : existing.inventoryItemId;
    const nextInventoryBatchId =
      dto.inventoryBatchId !== undefined
        ? dto.inventoryBatchId ?? null
        : existing.inventoryBatchId;
    const nextDescription =
      dto.description !== undefined
        ? dto.description.trim() || null
        : existing.description;
    const nextRequestedQty =
      dto.requestedQty !== undefined ? dto.requestedQty : existing.requestedQty;
    const nextCompletedQty =
      dto.completedQty !== undefined ? dto.completedQty : existing.completedQty;

    this.assertLineIdentity(
      nextInventoryItemId,
      nextInventoryBatchId,
      nextDescription,
    );
    this.assertCompletedQtyWithinRequested(nextCompletedQty, nextRequestedQty);

    if (nextInventoryItemId && nextInventoryBatchId) {
      await this.inventoryBridge.assertItemBelongsToBatch(
        tenantId,
        nextInventoryItemId,
        nextInventoryBatchId,
      );
    }

    const data: Prisma.WarehouseJobLineUpdateInput = {};
    const changedFields: Record<string, unknown> = {};

    if (dto.inventoryItemId !== undefined) {
      data.inventoryItem = dto.inventoryItemId
        ? { connect: { id: dto.inventoryItemId } }
        : { disconnect: true };
      changedFields.inventoryItemId = nextInventoryItemId;
    }
    if (dto.inventoryBatchId !== undefined) {
      data.inventoryBatch = dto.inventoryBatchId
        ? { connect: { id: dto.inventoryBatchId } }
        : { disconnect: true };
      changedFields.inventoryBatchId = nextInventoryBatchId;
    }
    if (dto.description !== undefined) {
      data.description = nextDescription;
      changedFields.description = nextDescription;
    }
    if (dto.requestedQty !== undefined) {
      data.requestedQty = dto.requestedQty;
      changedFields.requestedQty = dto.requestedQty;
    }
    if (dto.completedQty !== undefined) {
      data.completedQty = dto.completedQty;
      changedFields.completedQty = dto.completedQty;
    }
    if (dto.sortOrder !== undefined) {
      data.sortOrder = dto.sortOrder;
      changedFields.sortOrder = dto.sortOrder;
    }
    if (dto.notes !== undefined) {
      data.notes = dto.notes.trim() || null;
      changedFields.notes = dto.notes.trim() || null;
    }

    return this.prisma.$transaction(async (tx) => {
      const line = await tx.warehouseJobLine.update({
        where: { id: existing.id },
        data,
        include: lineListInclude,
      });

      if (Object.keys(changedFields).length > 0) {
        await this.eventsService.append(tx, {
          tenantId,
          warehouseJobId,
          actorUserId,
          eventType: WarehouseJobEventType.LINE_UPDATED,
          payload: {
            lineId: line.id,
            changedFields,
          } as Prisma.InputJsonValue,
        });
      }

      const unitCountsByLine = await this.loadUnitCountsByLine(
        tenantId,
        warehouseJobId,
        [line.id],
        tx,
      );

      return this.toLineResponse(line, unitCountsByLine.get(line.id));
    });
  }

  async delete(
    tenantId: string,
    warehouseJobId: string,
    lineId: string,
    actorUserId?: string,
  ) {
    await this.assertParentJobMutable(tenantId, warehouseJobId);
    const existing = await this.findLineOrThrow(tenantId, warehouseJobId, lineId);

    const linkedUnitCount = await this.prisma.warehouseJobUnit.count({
      where: { tenantId, warehouseJobLineId: lineId },
    });

    if (linkedUnitCount > 0) {
      throw new BadRequestException('Cannot delete line with linked units.');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.eventsService.append(tx, {
        tenantId,
        warehouseJobId,
        actorUserId,
        eventType: WarehouseJobEventType.LINE_REMOVED,
        payload: {
          lineId: existing.id,
          inventoryItemId: existing.inventoryItemId,
          inventoryBatchId: existing.inventoryBatchId,
          description: existing.description,
          requestedQty: existing.requestedQty,
          completedQty: existing.completedQty,
          sortOrder: existing.sortOrder,
        },
      });

      await tx.warehouseJobLine.delete({ where: { id: existing.id } });

      return { deleted: true, lineId: existing.id };
    });
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

  private async assertParentJobMutable(
    tenantId: string,
    warehouseJobId: string,
  ) {
    const job = await this.findParentJobOrThrow(tenantId, warehouseJobId);

    if (!MUTABLE_JOB_STATUSES.has(job.status)) {
      throw new BadRequestException(
        `Cannot modify lines when warehouse job status is ${job.status}`,
      );
    }
  }

  private async findLineOrThrow(
    tenantId: string,
    warehouseJobId: string,
    lineId: string,
  ) {
    const line = await this.prisma.warehouseJobLine.findFirst({
      where: { id: lineId, warehouseJobId, tenantId },
    });

    if (!line) {
      throw new NotFoundException('Warehouse job line not found');
    }

    return line;
  }

  private assertLineIdentity(
    inventoryItemId?: string | null,
    inventoryBatchId?: string | null,
    description?: string | null,
  ) {
    if (!inventoryItemId && !inventoryBatchId && !description?.trim()) {
      throw new BadRequestException(
        'Description is required when no inventory item or batch is specified',
      );
    }
  }

  private assertCompletedQtyWithinRequested(
    completedQty: number,
    requestedQty: number,
  ) {
    if (completedQty > requestedQty) {
      throw new BadRequestException(
        'completedQty cannot exceed requestedQty',
      );
    }
  }

  private async nextSortOrder(
    client: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    warehouseJobId: string,
  ) {
    const agg = await client.warehouseJobLine.aggregate({
      where: { tenantId, warehouseJobId },
      _max: { sortOrder: true },
    });

    return (agg._max.sortOrder ?? -1) + 1;
  }

  private async loadUnitCountsByLine(
    tenantId: string,
    warehouseJobId: string,
    lineIds: string[],
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const counts = new Map<
      string,
      { planned: number; confirmed: number; released: number; total: number }
    >();

    if (lineIds.length === 0) {
      return counts;
    }

    const rows = await client.warehouseJobUnit.groupBy({
      by: ['warehouseJobLineId', 'linkStatus'],
      where: {
        tenantId,
        warehouseJobId,
        warehouseJobLineId: { in: lineIds },
      },
      _count: { _all: true },
    });

    for (const lineId of lineIds) {
      counts.set(lineId, { planned: 0, confirmed: 0, released: 0, total: 0 });
    }

    for (const row of rows) {
      if (!row.warehouseJobLineId) continue;
      const entry = counts.get(row.warehouseJobLineId)!;
      const n = row._count._all;
      entry.total += n;
      if (row.linkStatus === WarehouseJobUnitLinkStatus.PLANNED) {
        entry.planned += n;
      } else if (row.linkStatus === WarehouseJobUnitLinkStatus.CONFIRMED) {
        entry.confirmed += n;
      } else if (row.linkStatus === WarehouseJobUnitLinkStatus.RELEASED) {
        entry.released += n;
      }
    }

    return counts;
  }

  private toLineResponse(
    line: LineWithIncludes,
    unitCounts?: {
      planned: number;
      confirmed: number;
      released: number;
      total: number;
    },
  ) {
    return {
      ...line,
      unitCounts: unitCounts ?? {
        planned: 0,
        confirmed: 0,
        released: 0,
        total: line._count.units,
      },
    };
  }
}

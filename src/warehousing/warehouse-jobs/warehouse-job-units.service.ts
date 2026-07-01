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
import {
  WarehouseJobDbClient,
  WarehouseJobEventsService,
} from './warehouse-job-events.service';
import { WarehouseJobLifecycleService } from './warehouse-job-lifecycle.service';
import {
  ResolvedInventoryUnit,
  WarehouseInventoryBridgeService,
} from './warehouse-inventory-bridge.service';
import { LinkWarehouseJobUnitsDto } from './dto/link-warehouse-job-units.dto';
import { ConfirmWarehouseJobUnitsDto } from './dto/confirm-warehouse-job-units.dto';
import { ReleaseWarehouseJobUnitsDto } from './dto/release-warehouse-job-units.dto';
import { ListWarehouseJobUnitsQueryDto } from './dto/list-warehouse-job-units-query.dto';

const LINK_RELEASE_ALLOWED_STATUSES = new Set<WarehouseJobStatus>([
  WarehouseJobStatus.DRAFT,
  WarehouseJobStatus.OPEN,
  WarehouseJobStatus.IN_PROGRESS,
]);

const CONFIRM_ALLOWED_STATUSES = new Set<WarehouseJobStatus>([
  WarehouseJobStatus.OPEN,
  WarehouseJobStatus.IN_PROGRESS,
]);

const TERMINAL_JOB_STATUSES = new Set<WarehouseJobStatus>([
  WarehouseJobStatus.COMPLETED,
  WarehouseJobStatus.CANCELLED,
]);

const unitListInclude = {
  inventoryUnit: {
    select: {
      id: true,
      unitSku: true,
      status: true,
      inventoryItemId: true,
      batchId: true,
      inventory_item: {
        select: { id: true, sku: true, name: true, reference: true },
      },
      batch: {
        select: { id: true, containerNumber: true, batchDescription: true },
      },
    },
  },
  warehouseJobLine: {
    select: {
      id: true,
      description: true,
      sortOrder: true,
    },
  },
} satisfies Prisma.WarehouseJobUnitInclude;

type WarehouseJobUnitLinkRow = {
  id: string;
  inventoryUnitId: string;
  warehouseJobLineId: string | null;
  linkStatus: WarehouseJobUnitLinkStatus;
};

@Injectable()
export class WarehouseJobUnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: WarehouseJobEventsService,
    private readonly inventoryBridge: WarehouseInventoryBridgeService,
    private readonly lifecycleService: WarehouseJobLifecycleService,
  ) {}

  async list(
    tenantId: string,
    warehouseJobId: string,
    query: ListWarehouseJobUnitsQueryDto = {},
  ) {
    await this.findParentJobOrThrow(tenantId, warehouseJobId);

    const where: Prisma.WarehouseJobUnitWhereInput = {
      tenantId,
      warehouseJobId,
    };

    if (query.lineId) {
      where.warehouseJobLineId = query.lineId;
    }
    if (query.linkStatus) {
      where.linkStatus = query.linkStatus;
    }

    return this.prisma.warehouseJobUnit.findMany({
      where,
      orderBy: [
        { warehouseJobLine: { sortOrder: 'asc' } },
        { createdAt: 'asc' },
      ],
      include: unitListInclude,
    });
  }

  async linkToLine(
    tenantId: string,
    warehouseJobId: string,
    lineId: string,
    dto: LinkWarehouseJobUnitsDto,
    actorUserId?: string,
  ) {
    return this.link(tenantId, warehouseJobId, dto, actorUserId, lineId);
  }

  async linkToJob(
    tenantId: string,
    warehouseJobId: string,
    dto: LinkWarehouseJobUnitsDto,
    actorUserId?: string,
  ) {
    const lineId = dto.warehouseJobLineId ?? null;
    return this.link(tenantId, warehouseJobId, dto, actorUserId, lineId);
  }

  async confirmForLine(
    tenantId: string,
    warehouseJobId: string,
    lineId: string,
    dto: ConfirmWarehouseJobUnitsDto,
    actorUserId?: string,
  ) {
    await this.findLineOrThrow(tenantId, warehouseJobId, lineId);
    return this.confirmUnits(
      tenantId,
      warehouseJobId,
      dto,
      actorUserId,
      lineId,
    );
  }

  async confirmForJob(
    tenantId: string,
    warehouseJobId: string,
    dto: ConfirmWarehouseJobUnitsDto,
    actorUserId?: string,
  ) {
    return this.confirmUnits(
      tenantId,
      warehouseJobId,
      dto,
      actorUserId,
      undefined,
    );
  }

  async releaseForLine(
    tenantId: string,
    warehouseJobId: string,
    lineId: string,
    dto: ReleaseWarehouseJobUnitsDto,
    actorUserId?: string,
  ) {
    await this.findLineOrThrow(tenantId, warehouseJobId, lineId);
    return this.releaseUnits(
      tenantId,
      warehouseJobId,
      dto,
      actorUserId,
      lineId,
    );
  }

  async releaseForJob(
    tenantId: string,
    warehouseJobId: string,
    dto: ReleaseWarehouseJobUnitsDto,
    actorUserId?: string,
  ) {
    return this.releaseUnits(
      tenantId,
      warehouseJobId,
      dto,
      actorUserId,
      undefined,
    );
  }

  private async link(
    tenantId: string,
    warehouseJobId: string,
    dto: LinkWarehouseJobUnitsDto,
    actorUserId: string | undefined,
    lineId: string | null,
  ) {
    await this.assertJobAllowsLinkRelease(tenantId, warehouseJobId);
    if (lineId) {
      await this.validateLineForUnits(tenantId, warehouseJobId, lineId);
    }

    const units = await this.inventoryBridge.resolveInventoryUnitsForTenant(
      tenantId,
      {
        inventoryUnitIds: dto.inventoryUnitIds,
        unitSkus: dto.unitSkus,
      },
    );

    if (lineId) {
      const line = await this.findLineOrThrow(tenantId, warehouseJobId, lineId);
      await this.inventoryBridge.assertLineInventoryCompatibility(
        tenantId,
        line,
        units,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      let linked = 0;
      let alreadyLinked = 0;
      let restoredFromReleased = 0;
      const linkedUnitIds: string[] = [];
      const linkedUnitSkus: string[] = [];

      for (const unit of units) {
        const existing = await tx.warehouseJobUnit.findUnique({
          where: {
            tenantId_warehouseJobId_inventoryUnitId: {
              tenantId,
              warehouseJobId,
              inventoryUnitId: unit.id,
            },
          },
        });

        if (!existing) {
          await tx.warehouseJobUnit.create({
            data: {
              tenantId,
              warehouseJobId,
              warehouseJobLineId: lineId,
              inventoryUnitId: unit.id,
              linkStatus: WarehouseJobUnitLinkStatus.PLANNED,
            },
          });
          linked += 1;
          linkedUnitIds.push(unit.id);
          linkedUnitSkus.push(unit.unitSku);
          continue;
        }

        if (
          existing.linkStatus === WarehouseJobUnitLinkStatus.PLANNED ||
          existing.linkStatus === WarehouseJobUnitLinkStatus.CONFIRMED
        ) {
          alreadyLinked += 1;
          continue;
        }

        if (existing.linkStatus === WarehouseJobUnitLinkStatus.RELEASED) {
          await tx.warehouseJobUnit.update({
            where: { id: existing.id },
            data: {
              linkStatus: WarehouseJobUnitLinkStatus.PLANNED,
              warehouseJobLineId: lineId,
              releasedAt: null,
              confirmedAt: null,
            },
          });
          restoredFromReleased += 1;
          linkedUnitIds.push(unit.id);
          linkedUnitSkus.push(unit.unitSku);
        }
      }

      if (linked + restoredFromReleased > 0) {
        await this.eventsService.append(tx, {
          tenantId,
          warehouseJobId,
          actorUserId,
          eventType: WarehouseJobEventType.UNIT_LINKED,
          payload: {
            lineId,
            unitIds: linkedUnitIds,
            unitSkus: linkedUnitSkus,
            linked,
            alreadyLinked,
            restoredFromReleased,
          },
        });
      }

      return { linked, alreadyLinked, restoredFromReleased };
    });
  }

  private async confirmUnits(
    tenantId: string,
    warehouseJobId: string,
    dto: ConfirmWarehouseJobUnitsDto,
    actorUserId: string | undefined,
    lineId: string | undefined,
  ) {
    await this.assertJobAllowsConfirm(tenantId, warehouseJobId);
    const units = await this.inventoryBridge.resolveInventoryUnitsForTenant(
      tenantId,
      {
        inventoryUnitIds: dto.inventoryUnitIds,
        unitSkus: dto.unitSkus,
      },
    );
    const unitIds = units.map((unit) => unit.id);

    return this.prisma.$transaction(async (tx) => {
      const links = await tx.warehouseJobUnit.findMany({
        where: {
          tenantId,
          warehouseJobId,
          inventoryUnitId: { in: unitIds },
          ...(lineId !== undefined ? { warehouseJobLineId: lineId } : {}),
        },
      });

      this.assertAllUnitsLinked(units, links, lineId);

      const affectedLineIds = this.collectAffectedLineIds(links);

      for (const affectedLineId of affectedLineIds) {
        const lineLinks = links.filter(
          (link) => link.warehouseJobLineId === affectedLineId,
        );
        await this.assertLineCapacityForConfirm(
          tx,
          tenantId,
          warehouseJobId,
          affectedLineId,
          lineLinks,
        );
      }

      const now = new Date();
      let confirmed = 0;
      let alreadyConfirmed = 0;
      const confirmedUnitIds: string[] = [];
      const confirmedUnitSkus: string[] = [];

      for (const link of links) {
        if (link.linkStatus === WarehouseJobUnitLinkStatus.CONFIRMED) {
          alreadyConfirmed += 1;
          continue;
        }

        if (link.linkStatus === WarehouseJobUnitLinkStatus.RELEASED) {
          throw new BadRequestException(
            `Unit ${link.inventoryUnitId} is released; link again before confirming`,
          );
        }

        await tx.warehouseJobUnit.update({
          where: { id: link.id },
          data: {
            linkStatus: WarehouseJobUnitLinkStatus.CONFIRMED,
            confirmedAt: now,
            releasedAt: null,
          },
        });
        confirmed += 1;
        confirmedUnitIds.push(link.inventoryUnitId);
        const unit = units.find((u) => u.id === link.inventoryUnitId);
        if (unit) confirmedUnitSkus.push(unit.unitSku);
      }

      const updatedCompletedQtyByLine: Record<string, number> = {};
      for (const affectedLineId of affectedLineIds) {
        updatedCompletedQtyByLine[affectedLineId] =
          await this.recalculateLineCompletedQty(
            tx,
            tenantId,
            warehouseJobId,
            affectedLineId,
          );
      }

      if (confirmed > 0) {
        await this.eventsService.append(tx, {
          tenantId,
          warehouseJobId,
          actorUserId,
          eventType: WarehouseJobEventType.UNIT_CONFIRMED,
          payload: {
            lineId: lineId ?? null,
            unitIds: confirmedUnitIds,
            unitSkus: confirmedUnitSkus,
            confirmed,
            alreadyConfirmed,
            affectedLineIds,
            updatedCompletedQtyByLine,
          },
        });
      }

      const { autoCompleted } = await this.lifecycleService.maybeAutoCompleteJob(
        tx,
        tenantId,
        warehouseJobId,
        actorUserId,
      );

      return {
        confirmed,
        alreadyConfirmed,
        updatedCompletedQtyByLine,
        autoCompleted,
      };
    });
  }

  private async releaseUnits(
    tenantId: string,
    warehouseJobId: string,
    dto: ReleaseWarehouseJobUnitsDto,
    actorUserId: string | undefined,
    lineId: string | undefined,
  ) {
    await this.assertJobAllowsLinkRelease(tenantId, warehouseJobId);
    const units = await this.inventoryBridge.resolveInventoryUnitsForTenant(
      tenantId,
      {
        inventoryUnitIds: dto.inventoryUnitIds,
        unitSkus: dto.unitSkus,
      },
    );
    const unitIds = units.map((unit) => unit.id);

    return this.prisma.$transaction(async (tx) => {
      const links = await tx.warehouseJobUnit.findMany({
        where: {
          tenantId,
          warehouseJobId,
          inventoryUnitId: { in: unitIds },
          ...(lineId !== undefined ? { warehouseJobLineId: lineId } : {}),
        },
      });

      this.assertAllUnitsLinked(units, links, lineId);

      const affectedLineIds = this.collectAffectedLineIds(links);
      const now = new Date();
      let released = 0;
      let alreadyReleased = 0;
      const releasedUnitIds: string[] = [];
      const releasedUnitSkus: string[] = [];

      for (const link of links) {
        if (link.linkStatus === WarehouseJobUnitLinkStatus.RELEASED) {
          alreadyReleased += 1;
          continue;
        }

        await tx.warehouseJobUnit.update({
          where: { id: link.id },
          data: {
            linkStatus: WarehouseJobUnitLinkStatus.RELEASED,
            releasedAt: now,
          },
        });
        released += 1;
        releasedUnitIds.push(link.inventoryUnitId);
        const unit = units.find((u) => u.id === link.inventoryUnitId);
        if (unit) releasedUnitSkus.push(unit.unitSku);
      }

      const updatedCompletedQtyByLine: Record<string, number> = {};
      for (const affectedLineId of affectedLineIds) {
        updatedCompletedQtyByLine[affectedLineId] =
          await this.recalculateLineCompletedQty(
            tx,
            tenantId,
            warehouseJobId,
            affectedLineId,
          );
      }

      if (released > 0) {
        await this.eventsService.append(tx, {
          tenantId,
          warehouseJobId,
          actorUserId,
          eventType: WarehouseJobEventType.UNIT_RELEASED,
          payload: {
            lineId: lineId ?? null,
            unitIds: releasedUnitIds,
            unitSkus: releasedUnitSkus,
            released,
            alreadyReleased,
            affectedLineIds,
            updatedCompletedQtyByLine,
          },
        });
      }

      return {
        released,
        alreadyReleased,
        updatedCompletedQtyByLine,
      };
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

  private async assertJobAllowsLinkRelease(
    tenantId: string,
    warehouseJobId: string,
  ) {
    const job = await this.findParentJobOrThrow(tenantId, warehouseJobId);

    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      throw new BadRequestException(
        `Cannot modify units when warehouse job status is ${job.status}`,
      );
    }

    if (!LINK_RELEASE_ALLOWED_STATUSES.has(job.status)) {
      throw new BadRequestException(
        `Cannot modify units when warehouse job status is ${job.status}`,
      );
    }

    return job;
  }

  private async assertJobAllowsConfirm(
    tenantId: string,
    warehouseJobId: string,
  ) {
    const job = await this.findParentJobOrThrow(tenantId, warehouseJobId);

    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      throw new BadRequestException(
        `Cannot confirm units when warehouse job status is ${job.status}`,
      );
    }

    if (!CONFIRM_ALLOWED_STATUSES.has(job.status)) {
      throw new BadRequestException(
        `Cannot confirm units when warehouse job status is ${job.status}`,
      );
    }

    return job;
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

  private async validateLineForUnits(
    tenantId: string,
    warehouseJobId: string,
    lineId: string,
  ) {
    await this.findLineOrThrow(tenantId, warehouseJobId, lineId);
  }

  private assertAllUnitsLinked(
    units: ResolvedInventoryUnit[],
    links: Array<{ inventoryUnitId: string }>,
    lineId: string | undefined,
  ) {
    const linkedIds = new Set(links.map((link) => link.inventoryUnitId));
    const missing = units.filter((unit) => !linkedIds.has(unit.id));

    if (missing.length > 0) {
      const suffix =
        lineId !== undefined ? ' for the specified line' : ' for this job';
      throw new BadRequestException(
        `Units not linked to warehouse job${suffix}: ${missing.map((u) => u.unitSku).join(', ')}`,
      );
    }
  }

  private collectAffectedLineIds(
    links: Array<{ warehouseJobLineId: string | null }>,
  ): string[] {
    return [
      ...new Set(
        links
          .map((link) => link.warehouseJobLineId)
          .filter((id): id is string => id != null),
      ),
    ];
  }

  private async countConfirmedUnitsForLine(
    tx: WarehouseJobDbClient,
    tenantId: string,
    warehouseJobId: string,
    warehouseJobLineId: string,
  ): Promise<number> {
    return tx.warehouseJobUnit.count({
      where: {
        tenantId,
        warehouseJobId,
        warehouseJobLineId,
        linkStatus: WarehouseJobUnitLinkStatus.CONFIRMED,
      },
    });
  }

  private async assertLineCapacityForConfirm(
    tx: WarehouseJobDbClient,
    tenantId: string,
    warehouseJobId: string,
    warehouseJobLineId: string,
    linksForLine: WarehouseJobUnitLinkRow[],
  ): Promise<void> {
    const line = await tx.warehouseJobLine.findFirst({
      where: { id: warehouseJobLineId, warehouseJobId, tenantId },
      select: { requestedQty: true },
    });

    if (!line) {
      throw new NotFoundException('Warehouse job line not found');
    }

    const currentConfirmed = await this.countConfirmedUnitsForLine(
      tx,
      tenantId,
      warehouseJobId,
      warehouseJobLineId,
    );

    if (currentConfirmed > line.requestedQty) {
      throw new BadRequestException(
        `Line ${warehouseJobLineId} already has ${currentConfirmed} confirmed units exceeding requestedQty ${line.requestedQty}`,
      );
    }

    const newlyConfirming = linksForLine.filter(
      (link) => link.linkStatus === WarehouseJobUnitLinkStatus.PLANNED,
    ).length;

    const projected = currentConfirmed + newlyConfirming;
    if (projected > line.requestedQty) {
      throw new BadRequestException(
        `Confirming units would exceed line requestedQty (${line.requestedQty})`,
      );
    }
  }

  private async recalculateLineCompletedQty(
    tx: WarehouseJobDbClient,
    tenantId: string,
    warehouseJobId: string,
    warehouseJobLineId: string,
  ): Promise<number> {
    const line = await tx.warehouseJobLine.findFirst({
      where: { id: warehouseJobLineId, warehouseJobId, tenantId },
      select: { id: true, requestedQty: true },
    });

    if (!line) {
      throw new NotFoundException('Warehouse job line not found');
    }

    const confirmedCount = await this.countConfirmedUnitsForLine(
      tx,
      tenantId,
      warehouseJobId,
      warehouseJobLineId,
    );

    if (confirmedCount > line.requestedQty) {
      throw new BadRequestException(
        `Line ${warehouseJobLineId} has ${confirmedCount} confirmed units exceeding requestedQty ${line.requestedQty}`,
      );
    }

    await tx.warehouseJobLine.update({
      where: { id: line.id },
      data: { completedQty: confirmedCount },
    });

    return confirmedCount;
  }
}

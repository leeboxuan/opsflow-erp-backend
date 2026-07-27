import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WarehouseJobEventType, WarehouseJobStatus } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  formatWarehouseCustomerReference,
  resolveUserInitial,
  warehouseCustomerRefYear,
} from './warehouse-job-customer-ref';
import {
  WarehouseJobDbClient,
  WarehouseJobEventsService,
} from './warehouse-job-events.service';

const TERMINAL_STATUSES = new Set<WarehouseJobStatus>([
  WarehouseJobStatus.COMPLETED,
  WarehouseJobStatus.CANCELLED,
]);

const ALLOWED_TRANSITIONS: Record<
  WarehouseJobStatus,
  Set<WarehouseJobStatus>
> = {
  [WarehouseJobStatus.DRAFT]: new Set([
    WarehouseJobStatus.OPEN,
    WarehouseJobStatus.CANCELLED,
  ]),
  [WarehouseJobStatus.OPEN]: new Set([
    WarehouseJobStatus.IN_PROGRESS,
    WarehouseJobStatus.CANCELLED,
  ]),
  [WarehouseJobStatus.IN_PROGRESS]: new Set([
    WarehouseJobStatus.COMPLETED,
    WarehouseJobStatus.CANCELLED,
  ]),
  [WarehouseJobStatus.COMPLETED]: new Set(),
  [WarehouseJobStatus.CANCELLED]: new Set(),
};

@Injectable()
export class WarehouseJobLifecycleService {
  private static readonly INTERNAL_REF_PREFIX = 'WH';

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: WarehouseJobEventsService,
  ) {}

  async allocateInternalRef(
    client: WarehouseJobDbClient,
    tenantId: string,
    now: Date = new Date(),
  ): Promise<string> {
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const yyyymm = `${yyyy}-${mm}`;

    const row = await client.warehouse_job_internal_ref_counters.upsert({
      where: {
        tenantId_yyyymm: { tenantId, yyyymm },
      },
      create: { tenantId, yyyymm, nextSeq: 1 },
      update: { nextSeq: { increment: 1 } },
      select: { nextSeq: true },
    });

    const seq = String(row.nextSeq).padStart(4, '0');
    return `${WarehouseJobLifecycleService.INTERNAL_REF_PREFIX}-${yyyy}-${mm}-${seq}`;
  }

  async allocateCustomerReference(
    client: WarehouseJobDbClient,
    tenantId: string,
    customerInitial: string,
    creatorInitial: string,
    now: Date = new Date(),
  ): Promise<{ customerReference: string; customerReferenceSeq: number; yy: string }> {
    const normalizedCustomerInitial = customerInitial.trim().toUpperCase();
    if (!normalizedCustomerInitial) {
      throw new BadRequestException('customerInitial is required');
    }

    const yy = warehouseCustomerRefYear(now);
    const row = await client.warehouse_job_customer_ref_counters.upsert({
      where: {
        tenantId_yy_customerInitial: {
          tenantId,
          yy,
          customerInitial: normalizedCustomerInitial,
        },
      },
      create: {
        tenantId,
        yy,
        customerInitial: normalizedCustomerInitial,
        nextSeq: 1,
      },
      update: { nextSeq: { increment: 1 } },
      select: { nextSeq: true },
    });

    const customerReference = formatWarehouseCustomerReference(
      creatorInitial,
      yy,
      normalizedCustomerInitial,
      row.nextSeq,
    );

    return {
      customerReference,
      customerReferenceSeq: row.nextSeq,
      yy,
    };
  }

  async resolveCreatorInitial(
    client: WarehouseJobDbClient,
    actorUserId?: string,
  ): Promise<string> {
    if (!actorUserId) return 'XX';

    const user = await client.user.findFirst({
      where: { id: actorUserId },
      select: { displayName: true, name: true, email: true },
    });

    return resolveUserInitial(user?.displayName, user?.name, user?.email);
  }

  assertTransition(
    fromStatus: WarehouseJobStatus,
    toStatus: WarehouseJobStatus,
  ): void {
    if (TERMINAL_STATUSES.has(fromStatus)) {
      throw new BadRequestException(
        `Cannot transition from terminal status ${fromStatus}`,
      );
    }

    if (!ALLOWED_TRANSITIONS[fromStatus]?.has(toStatus)) {
      throw new BadRequestException(
        `Invalid status transition: ${fromStatus} -> ${toStatus}`,
      );
    }
  }

  async open(tenantId: string, id: string, actorUserId?: string) {
    return this.transition(tenantId, id, WarehouseJobStatus.OPEN, actorUserId);
  }

  async start(tenantId: string, id: string, actorUserId?: string) {
    const existing = await this.prisma.warehouseJob.findFirst({
      where: { id, tenantId },
      include: warehouseJobDetailInclude,
    });

    if (!existing) {
      throw new NotFoundException('Warehouse job not found');
    }

    if (existing.status === WarehouseJobStatus.IN_PROGRESS) {
      return existing;
    }

    return this.transition(
      tenantId,
      id,
      WarehouseJobStatus.IN_PROGRESS,
      actorUserId,
    );
  }

  async complete(tenantId: string, id: string, actorUserId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertManualCompleteAllowed(tx, tenantId, id);
      return this.performTransition(
        tx,
        tenantId,
        id,
        WarehouseJobStatus.COMPLETED,
        actorUserId,
      );
    });
  }

  async cancel(
    tenantId: string,
    id: string,
    actorUserId?: string,
    reason?: string,
  ) {
    return this.transition(
      tenantId,
      id,
      WarehouseJobStatus.CANCELLED,
      actorUserId,
      { cancelledReason: reason?.trim() || null },
    );
  }

  /**
   * Auto-complete an IN_PROGRESS job when all lines reach requested quantity.
   * Must be called inside an existing transaction after line completedQty updates.
   */
  async maybeAutoCompleteJob(
    tx: WarehouseJobDbClient,
    tenantId: string,
    warehouseJobId: string,
    actorUserId?: string,
  ): Promise<{ autoCompleted: boolean }> {
    const job = await tx.warehouseJob.findFirst({
      where: { id: warehouseJobId, tenantId },
      select: { id: true, status: true, completedAt: true },
    });

    if (!job || job.status !== WarehouseJobStatus.IN_PROGRESS) {
      return { autoCompleted: false };
    }

    const lines = await tx.warehouseJobLine.findMany({
      where: { tenantId, warehouseJobId },
      select: { requestedQty: true, completedQty: true },
    });

    if (!this.areLinesReadyForAutoComplete(lines)) {
      return { autoCompleted: false };
    }

    const now = new Date();
    await tx.warehouseJob.update({
      where: { id: job.id },
      data: {
        status: WarehouseJobStatus.COMPLETED,
        completedAt: job.completedAt ?? now,
      },
    });

    await this.eventsService.append(tx, {
      tenantId,
      warehouseJobId: job.id,
      actorUserId,
      eventType: WarehouseJobEventType.STATUS_CHANGED,
      fromStatus: WarehouseJobStatus.IN_PROGRESS,
      toStatus: WarehouseJobStatus.COMPLETED,
    });

    return { autoCompleted: true };
  }

  /**
   * Lifecycle audit policy:
   * - Always append STATUS_CHANGED with fromStatus/toStatus.
   * - When cancelling with a reason, also append CANCELLED with reason in payload.
   */
  private async transition(
    tenantId: string,
    id: string,
    toStatus: WarehouseJobStatus,
    actorUserId?: string,
    extras?: { cancelledReason?: string | null },
  ) {
    return this.prisma.$transaction(async (tx) => {
      return this.performTransition(
        tx,
        tenantId,
        id,
        toStatus,
        actorUserId,
        extras,
      );
    });
  }

  private async performTransition(
    tx: WarehouseJobDbClient,
    tenantId: string,
    id: string,
    toStatus: WarehouseJobStatus,
    actorUserId?: string,
    extras?: { cancelledReason?: string | null },
  ) {
    const job = await tx.warehouseJob.findFirst({
      where: { id, tenantId },
    });

    if (!job) {
      throw new NotFoundException('Warehouse job not found');
    }

    const fromStatus = job.status;
    this.assertTransition(fromStatus, toStatus);

    const now = new Date();
    const data: Prisma.WarehouseJobUpdateInput = { status: toStatus };

    if (toStatus === WarehouseJobStatus.IN_PROGRESS && !job.startedAt) {
      data.startedAt = now;
    }
    if (toStatus === WarehouseJobStatus.COMPLETED) {
      data.completedAt = now;
    }
    if (toStatus === WarehouseJobStatus.CANCELLED) {
      data.cancelledAt = now;
      if (extras?.cancelledReason) {
        data.cancelledReason = extras.cancelledReason;
      }
    }

    const updated = await tx.warehouseJob.update({
      where: { id: job.id },
      data,
      include: warehouseJobDetailInclude,
    });

    await this.eventsService.append(tx, {
      tenantId,
      warehouseJobId: job.id,
      actorUserId,
      eventType: WarehouseJobEventType.STATUS_CHANGED,
      fromStatus,
      toStatus,
    });

    if (
      toStatus === WarehouseJobStatus.CANCELLED &&
      extras?.cancelledReason
    ) {
      await this.eventsService.append(tx, {
        tenantId,
        warehouseJobId: job.id,
        actorUserId,
        eventType: WarehouseJobEventType.CANCELLED,
        fromStatus,
        toStatus,
        payload: { reason: extras.cancelledReason },
      });
    }

    return updated;
  }

  private async assertManualCompleteAllowed(
    tx: WarehouseJobDbClient,
    tenantId: string,
    warehouseJobId: string,
  ): Promise<void> {
    const job = await tx.warehouseJob.findFirst({
      where: { id: warehouseJobId, tenantId },
      select: { id: true },
    });

    if (!job) {
      throw new NotFoundException('Warehouse job not found');
    }

    const lines = await tx.warehouseJobLine.findMany({
      where: { tenantId, warehouseJobId },
      select: { requestedQty: true, completedQty: true },
    });

    if (lines.length === 0) {
      return;
    }

    const incomplete = lines.some(
      (line) => line.completedQty < line.requestedQty,
    );
    if (incomplete) {
      throw new BadRequestException(
        'Cannot complete warehouse job until all lines reach requested quantity',
      );
    }
  }

  private areLinesReadyForAutoComplete(
    lines: Array<{ requestedQty: number; completedQty: number }>,
  ): boolean {
    if (lines.length === 0) {
      return false;
    }
    if (!lines.some((line) => line.requestedQty > 0)) {
      return false;
    }
    return lines.every((line) => line.completedQty >= line.requestedQty);
  }
}

export const warehouseJobListInclude = {
  customerCompany: { select: { id: true, name: true } },
  inventoryBatch: { select: { id: true, containerNumber: true } },
  assignedToUser: { select: { id: true, name: true, email: true } },
  _count: { select: { lines: true, units: true, events: true } },
} satisfies Prisma.WarehouseJobInclude;

export const warehouseJobDetailInclude = {
  customerCompany: { select: { id: true, name: true } },
  inventoryBatch: {
    select: { id: true, containerNumber: true, batchDescription: true },
  },
  assignedToUser: { select: { id: true, name: true, email: true } },
  createdByUser: { select: { id: true, name: true, email: true } },
  cargoLines: {
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
  },
  events: {
    orderBy: { createdAt: 'desc' as const },
    take: 20,
    include: {
      actorUser: { select: { id: true, name: true, email: true } },
    },
  },
  _count: { select: { lines: true, units: true } },
} satisfies Prisma.WarehouseJobInclude;

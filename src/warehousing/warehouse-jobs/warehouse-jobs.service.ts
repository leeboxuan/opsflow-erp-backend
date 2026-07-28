import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Role,
  MembershipStatus,
  WarehouseJobEventType,
  WarehouseJobPriority,
  WarehouseJobStatus,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { parsePaginationFromQuery, buildPaginationMeta } from '../../shared/common/pagination';
import { applyQSearch } from '../../shared/common/listing/listing.search';
import { buildOrderBy } from '../../shared/common/listing/listing.sort';
import { WarehouseJobLifecycleService, warehouseJobDetailInclude, warehouseJobListInclude } from './warehouse-job-lifecycle.service';
import { WarehouseJobEventsService } from './warehouse-job-events.service';
import { WarehouseJobDocumentsService } from './warehouse-job-documents.service';
import { WarehouseJobCargoLinesService } from './warehouse-job-cargo-lines.service';
import { WarehouseJobContainersService } from './warehouse-job-containers.service';
import { WarehouseJobDeliveryOrderService } from './warehouse-job-delivery-order.service';
import { CreateWarehouseJobDto } from './dto/create-warehouse-job.dto';
import { UpdateWarehouseJobDto } from './dto/update-warehouse-job.dto';
import { ListWarehouseJobsQueryDto } from './dto/list-warehouse-jobs-query.dto';
import { ListWarehousingUsersQueryDto } from './dto/list-warehousing-users-query.dto';
import { UpdateWarehouseJobExecutionDto } from './dto/update-warehouse-job-execution.dto';
import {
  assertJobAllowsExecutionUpdate,
  assertJobAllowsFloorMutation,
  assertWarehouseUserCanAccessJob,
  buildWarehouseUserListWhere,
  isOpsLikeRole,
  WarehouseJobAccessRef,
} from './warehouse-job-access';
import {
  CS_IN_CHARGE_VALIDATION_MESSAGE,
  WAREHOUSE_IN_CHARGE_VALIDATION_MESSAGE,
  WAREHOUSE_JOB_CS_IN_CHARGE_ROLES,
  WAREHOUSE_JOB_WAREHOUSE_IN_CHARGE_ROLES,
  WAREHOUSING_USER_ROLES,
} from './warehouse-job-assignment';
import { publicEmailOrNull } from '../../shared/auth/auth-internal-email';
import { listTenantUsers } from '../../admin/admin-users.list';

function redactJobUserRef<T extends { email?: string | null } | null | undefined>(
  user: T,
): T {
  if (!user || typeof user !== 'object') return user;
  return { ...user, email: publicEmailOrNull(user.email) };
}

function redactWarehouseJobUserEmails<T extends Record<string, any>>(job: T): T {
  return {
    ...job,
    assignedToUser: redactJobUserRef(job.assignedToUser),
    csInChargeUser: redactJobUserRef(job.csInChargeUser),
    createdByUser: redactJobUserRef(job.createdByUser),
  };
}

const UPDATABLE_STATUSES = new Set<WarehouseJobStatus>([
  WarehouseJobStatus.DRAFT,
  WarehouseJobStatus.OPEN,
]);

@Injectable()
export class WarehouseJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: WarehouseJobLifecycleService,
    private readonly eventsService: WarehouseJobEventsService,
    private readonly documentsService: WarehouseJobDocumentsService,
    private readonly cargoLinesService: WarehouseJobCargoLinesService,
    private readonly containersService: WarehouseJobContainersService,
    private readonly deliveryOrderService: WarehouseJobDeliveryOrderService,
  ) {}

  async create(
    tenantId: string,
    dto: CreateWarehouseJobDto,
    actorUserId?: string,
  ) {
    if (dto.lines && dto.lines.length > 0) {
      throw new BadRequestException('Lines are not implemented yet.');
    }

    if (dto.generateCustomerReference && !dto.customerInitial?.trim()) {
      throw new BadRequestException(
        'customerInitial is required when generateCustomerReference is true',
      );
    }

    await this.validateCustomerCompanyId(tenantId, dto.customerCompanyId);
    await this.validateInventoryBatchId(tenantId, dto.inventoryBatchId);
    await this.validateAssignedToUserId(tenantId, dto.assignedToUserId);
    await this.validateCsInChargeUserId(tenantId, dto.csInChargeUserId);

    const shouldGenerateDo = dto.generateDeliveryOrder === true;
    const normalizedContainers = this.containersService.normalize(
      dto.containers ??
        (dto.containerNumber || dto.sealNumber
          ? [
              {
                containerNumber: dto.containerNumber,
                sealNumber: dto.sealNumber,
                notes: undefined,
              },
            ]
          : undefined),
    );
    const legacyContainerFields =
      this.containersService.legacyFieldsFromContainers(normalizedContainers);

    const job = await this.prisma.$transaction(async (tx) => {
      const internalRef = await this.lifecycleService.allocateInternalRef(
        tx,
        tenantId,
      );

      const creatorInitial = await this.lifecycleService.resolveCreatorInitial(
        tx,
        actorUserId,
      );

      let customerReference: string | null = null;
      let customerReferenceSeq: number | null = null;
      const customerInitial = dto.customerInitial?.trim().toUpperCase() || null;

      if (dto.generateCustomerReference && customerInitial) {
        const allocated = await this.lifecycleService.allocateCustomerReference(
          tx,
          tenantId,
          customerInitial,
          creatorInitial,
        );
        customerReference = allocated.customerReference;
        customerReferenceSeq = allocated.customerReferenceSeq;
      }

      const created = await tx.warehouseJob.create({
        data: {
          tenantId,
          internalRef,
          type: dto.type,
          status: WarehouseJobStatus.DRAFT,
          priority: dto.priority ?? WarehouseJobPriority.NORMAL,
          title: dto.title?.trim() || null,
          description: dto.description?.trim() || null,
          notes: dto.notes?.trim() || null,
          containerNumber: legacyContainerFields.containerNumber,
          sealNumber: legacyContainerFields.sealNumber,
          warehouseNotes: legacyContainerFields.warehouseNotes,
          customerCompanyId: dto.customerCompanyId ?? null,
          inventoryBatchId: dto.inventoryBatchId ?? null,
          assignedToUserId: dto.assignedToUserId ?? null,
          csInChargeUserId: dto.csInChargeUserId ?? null,
          createdByUserId: actorUserId ?? null,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          externalRefType: dto.externalRefType?.trim() || null,
          externalRefId: dto.externalRefId?.trim() || null,
          orderReference: dto.orderReference?.trim() || null,
          customerReference,
          customerInitial,
          creatorInitial,
          customerReferenceSeq,
          receivingVessel: dto.receivingVessel?.trim() || null,
          placeOfDelivery: dto.placeOfDelivery?.trim() || null,
          destinationCountry: dto.destinationCountry?.trim() || 'Singapore',
          arrivalDate: dto.arrivalDate ? new Date(dto.arrivalDate) : null,
          departureDate: dto.departureDate ? new Date(dto.departureDate) : null,
          generateDeliveryOrder: shouldGenerateDo,
        },
        include: warehouseJobDetailInclude,
      });

      if (dto.cargoLines?.length) {
        await this.cargoLinesService.createManyInTransaction(
          tx,
          tenantId,
          created.id,
          dto.cargoLines,
        );
      }

      if (normalizedContainers.length) {
        await this.containersService.createManyInTransaction(
          tx,
          tenantId,
          created.id,
          normalizedContainers,
        );
      }

      await this.eventsService.append(tx, {
        tenantId,
        warehouseJobId: created.id,
        actorUserId,
        eventType: WarehouseJobEventType.CREATED,
        toStatus: WarehouseJobStatus.DRAFT,
        payload: {
          type: dto.type,
          internalRef,
          customerReference,
          orderReference: dto.orderReference?.trim() || null,
        },
      });

      return created;
    });

    if (shouldGenerateDo) {
      const result = await this.deliveryOrderService.generate(
        tenantId,
        job.id,
        actorUserId,
        Role.TRANSPORT_STAFF,
      );
      return result.job;
    }

    if (dto.cargoLines?.length || normalizedContainers.length) {
      return this.getById(tenantId, job.id);
    }

    return job;
  }

  async generateDeliveryOrder(
    tenantId: string,
    id: string,
    actorUserId?: string,
    actorRole: Role = Role.TRANSPORT_STAFF,
  ) {
    const result = await this.deliveryOrderService.generate(
      tenantId,
      id,
      actorUserId,
      actorRole,
    );
    return result.job;
  }

  async list(
    tenantId: string,
    query: ListWarehouseJobsQueryDto,
    actorRole?: Role,
    actorUserId?: string,
  ) {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query);
    const where: Prisma.WarehouseJobWhereInput =
      actorRole === Role.WAREHOUSE && actorUserId
        ? buildWarehouseUserListWhere(tenantId, actorUserId)
        : { tenantId };

    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.priority) where.priority = query.priority;
    if (query.customerCompanyId) where.customerCompanyId = query.customerCompanyId;
    if (query.inventoryBatchId) where.inventoryBatchId = query.inventoryBatchId;
    if (query.assignedToUserId) where.assignedToUserId = query.assignedToUserId;
    if (query.csInChargeUserId) where.csInChargeUserId = query.csInChargeUserId;

    const searchTerm = query.search?.trim() || query.q?.trim();
    applyQSearch(where, searchTerm, [
      'internalRef',
      'title',
      'description',
      'notes',
    ]);

    const orderBy = buildOrderBy(
      query.sortBy,
      query.sortDir,
      ['createdAt', 'internalRef', 'status', 'priority', 'scheduledAt'],
      { createdAt: 'desc' },
    );

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.warehouseJob.count({ where }),
      this.prisma.warehouseJob.findMany({
        where,
        orderBy,
        skip,
        take,
        include: warehouseJobListInclude,
      }),
    ]);

    const docCounts = await this.documentsService.countDocumentsByReviewStatus(
      tenantId,
      rows.map((row) => row.id),
    );

    const data = rows.map((row) => {
      const counts = docCounts.get(row.id) ?? {
        totalDocuments: 0,
        pendingReviewDocuments: 0,
        approvedDocuments: 0,
        rejectedDocuments: 0,
      };
      return redactWarehouseJobUserEmails({
        ...row,
        documentCount: counts.totalDocuments,
        pendingReviewDocumentCount: counts.pendingReviewDocuments,
      });
    });

    return { data, meta: buildPaginationMeta(page, pageSize, total) };
  }

  /**
   * Compatibility list for warehousing-scoped roles (TRANSPORT_STAFF/OPS/WAREHOUSE).
   * Delegates to shared admin user list query — prefer GET /admin/users for new callers.
   */
  async listWarehousingUsers(
    tenantId: string,
    query: ListWarehousingUsersQueryDto,
  ) {
    return listTenantUsers(this.prisma, tenantId, query, {
      forcedRoles: WAREHOUSING_USER_ROLES,
      excludeDriver: true,
    });
  }

  async getById(
    tenantId: string,
    id: string,
    actorRole?: Role,
    actorUserId?: string,
  ) {
    const job = await this.prisma.warehouseJob.findFirst({
      where: { id, tenantId },
      include: {
        ...warehouseJobDetailInclude,
        documents: {
          orderBy: [{ createdAt: 'desc' }],
          include: {
            uploadedByUser: { select: { id: true, name: true, email: true } },
            reviewedByUser: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!job) {
      throw new NotFoundException('Warehouse job not found');
    }

    if (actorRole === Role.WAREHOUSE) {
      assertWarehouseUserCanAccessJob(job, actorUserId);
    }

    const docCounts = await this.documentsService.countDocumentsByReviewStatus(
      tenantId,
      [job.id],
    );
    const counts = docCounts.get(job.id) ?? {
      totalDocuments: 0,
      pendingReviewDocuments: 0,
      approvedDocuments: 0,
      rejectedDocuments: 0,
    };

    return redactWarehouseJobUserEmails({
      ...job,
      documentCounts: counts,
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateWarehouseJobDto,
    actorUserId?: string,
  ) {
    const existing = await this.prisma.warehouseJob.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException('Warehouse job not found');
    }

    if (!UPDATABLE_STATUSES.has(existing.status)) {
      throw new BadRequestException(
        `Cannot update warehouse job in status ${existing.status}`,
      );
    }

    await this.validateCustomerCompanyId(tenantId, dto.customerCompanyId);
    await this.validateInventoryBatchId(tenantId, dto.inventoryBatchId);
    await this.validateAssignedToUserId(tenantId, dto.assignedToUserId);
    await this.validateCsInChargeUserId(tenantId, dto.csInChargeUserId);

    const data: Prisma.WarehouseJobUpdateInput = {};

    if (dto.type !== undefined) data.type = dto.type;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.title !== undefined) data.title = dto.title?.trim() || null;
    if (dto.description !== undefined) {
      data.description = dto.description?.trim() || null;
    }
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;

    const replaceContainers = dto.containers !== undefined;
    const normalizedContainers = replaceContainers
      ? this.containersService.normalize(dto.containers)
      : null;
    if (normalizedContainers) {
      const legacy =
        this.containersService.legacyFieldsFromContainers(normalizedContainers);
      data.containerNumber = legacy.containerNumber;
      data.sealNumber = legacy.sealNumber;
      data.warehouseNotes = legacy.warehouseNotes;
    } else {
      if (dto.containerNumber !== undefined) {
        data.containerNumber = dto.containerNumber?.trim() || null;
      }
      if (dto.sealNumber !== undefined) {
        data.sealNumber = dto.sealNumber?.trim() || null;
      }
      if (dto.warehouseNotes !== undefined) {
        data.warehouseNotes = dto.warehouseNotes?.trim() || null;
      }
    }
    if (dto.customerCompanyId !== undefined) {
      data.customerCompany = dto.customerCompanyId
        ? { connect: { id: dto.customerCompanyId } }
        : { disconnect: true };
    }
    if (dto.inventoryBatchId !== undefined) {
      data.inventoryBatch = dto.inventoryBatchId
        ? { connect: { id: dto.inventoryBatchId } }
        : { disconnect: true };
    }
    if (dto.assignedToUserId !== undefined) {
      data.assignedToUser = dto.assignedToUserId
        ? { connect: { id: dto.assignedToUserId } }
        : { disconnect: true };
    }
    if (dto.csInChargeUserId !== undefined) {
      data.csInChargeUser = dto.csInChargeUserId
        ? { connect: { id: dto.csInChargeUserId } }
        : { disconnect: true };
    }
    if (dto.scheduledAt !== undefined) {
      data.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    }
    if (dto.externalRefType !== undefined) {
      data.externalRefType = dto.externalRefType?.trim() || null;
    }
    if (dto.externalRefId !== undefined) {
      data.externalRefId = dto.externalRefId?.trim() || null;
    }
    if (dto.orderReference !== undefined) {
      data.orderReference = dto.orderReference?.trim() || null;
    }
    if (dto.receivingVessel !== undefined) {
      data.receivingVessel = dto.receivingVessel?.trim() || null;
    }
    if (dto.placeOfDelivery !== undefined) {
      data.placeOfDelivery = dto.placeOfDelivery?.trim() || null;
    }
    if (dto.destinationCountry !== undefined) {
      data.destinationCountry = dto.destinationCountry?.trim() || 'Singapore';
    }
    if (dto.arrivalDate !== undefined) {
      data.arrivalDate = dto.arrivalDate ? new Date(dto.arrivalDate) : null;
    }
    if (dto.departureDate !== undefined) {
      data.departureDate = dto.departureDate ? new Date(dto.departureDate) : null;
    }
    if (dto.generateDeliveryOrder !== undefined) {
      data.generateDeliveryOrder = dto.generateDeliveryOrder;
    }

    const shouldGenerateDo =
      dto.generateDeliveryOrder === true && !existing.deliveryOrderDocumentId;

    const assignedChanged =
      dto.assignedToUserId !== undefined &&
      (dto.assignedToUserId ?? null) !== (existing.assignedToUserId ?? null);
    const csInChargeChanged =
      dto.csInChargeUserId !== undefined &&
      (dto.csInChargeUserId ?? null) !== (existing.csInChargeUserId ?? null);
    const notesChanged =
      dto.notes !== undefined &&
      (dto.notes?.trim() || null) !== (existing.notes ?? null);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.warehouseJob.update({
        where: { id: existing.id },
        data,
        include: warehouseJobDetailInclude,
      });

      if (normalizedContainers) {
        await this.containersService.replaceAllInTransaction(
          tx,
          tenantId,
          existing.id,
          normalizedContainers,
        );
      }

      if (assignedChanged || csInChargeChanged) {
        await this.eventsService.append(tx, {
          tenantId,
          warehouseJobId: existing.id,
          actorUserId,
          eventType: WarehouseJobEventType.ASSIGNED,
          payload: {
            assignedToUserId:
              dto.assignedToUserId !== undefined
                ? (dto.assignedToUserId ?? null)
                : existing.assignedToUserId,
            csInChargeUserId:
              dto.csInChargeUserId !== undefined
                ? (dto.csInChargeUserId ?? null)
                : existing.csInChargeUserId,
          },
        });
      }

      if (notesChanged) {
        await this.eventsService.append(tx, {
          tenantId,
          warehouseJobId: existing.id,
          actorUserId,
          eventType: WarehouseJobEventType.NOTE_ADDED,
          payload: { notes: dto.notes?.trim() || null },
        });
      }

      if (normalizedContainers) {
        return tx.warehouseJob.findFirstOrThrow({
          where: { id: existing.id, tenantId },
          include: warehouseJobDetailInclude,
        });
      }

      return updated;
    }).then(async (updated) => {
      if (shouldGenerateDo) {
        const result = await this.deliveryOrderService.generate(
          tenantId,
          existing.id,
          actorUserId,
          Role.TRANSPORT_STAFF,
        );
        return result.job;
      }
      return updated;
    });
  }

  open(tenantId: string, id: string, actorUserId?: string) {
    return this.lifecycleService.open(tenantId, id, actorUserId);
  }

  start(
    tenantId: string,
    id: string,
    actorUserId?: string,
    actorRole?: Role,
  ) {
    return this.lifecycleWithWarehouseAccess(
      tenantId,
      id,
      actorUserId,
      actorRole,
      (t, i, u) => this.lifecycleService.start(t, i, u),
    );
  }

  complete(
    tenantId: string,
    id: string,
    actorUserId?: string,
    actorRole?: Role,
  ) {
    return this.lifecycleWithWarehouseAccess(
      tenantId,
      id,
      actorUserId,
      actorRole,
      (t, i, u) => this.lifecycleService.complete(t, i, u),
    );
  }

  async updateExecution(
    tenantId: string,
    id: string,
    dto: UpdateWarehouseJobExecutionDto,
    actorUserId: string | undefined,
    actorRole: Role,
  ) {
    const existing = await this.prisma.warehouseJob.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        status: true,
        assignedToUserId: true,
        containerNumber: true,
        sealNumber: true,
        warehouseNotes: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Warehouse job not found');
    }

    assertJobAllowsExecutionUpdate(existing.status);

    if (actorRole === Role.WAREHOUSE) {
      assertWarehouseUserCanAccessJob(existing, actorUserId);
    } else if (!isOpsLikeRole(actorRole)) {
      throw new ForbiddenException('Insufficient role to update execution fields');
    }

    const data: Prisma.WarehouseJobUpdateInput = {};
    const changedFields: Record<string, unknown> = {};

    if (dto.containerNumber !== undefined) {
      const value = dto.containerNumber?.trim() || null;
      data.containerNumber = value;
      changedFields.containerNumber = value;
    }
    if (dto.sealNumber !== undefined) {
      const value = dto.sealNumber?.trim() || null;
      data.sealNumber = value;
      changedFields.sealNumber = value;
    }
    if (dto.warehouseNotes !== undefined) {
      const value = dto.warehouseNotes?.trim() || null;
      data.warehouseNotes = value;
      changedFields.warehouseNotes = value;
    }

    if (Object.keys(data).length === 0) {
      return this.getById(tenantId, id, actorRole, actorUserId);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.warehouseJob.update({
        where: { id: existing.id },
        data,
        include: warehouseJobDetailInclude,
      });

      await this.eventsService.append(tx, {
        tenantId,
        warehouseJobId: existing.id,
        actorUserId,
        eventType: WarehouseJobEventType.EXECUTION_UPDATED,
        payload: { changedFields } as unknown as Prisma.InputJsonValue,
      });

      return updated;
    });
  }

  private async lifecycleWithWarehouseAccess(
    tenantId: string,
    id: string,
    actorUserId: string | undefined,
    actorRole: Role | undefined,
    fn: (tenantId: string, id: string, actorUserId?: string) => Promise<any>,
  ) {
    if (actorRole === Role.WAREHOUSE) {
      const job = await this.prisma.warehouseJob.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          status: true,
          assignedToUserId: true,
        },
      });
      if (!job) {
        throw new NotFoundException('Warehouse job not found');
      }
      assertWarehouseUserCanAccessJob(job, actorUserId);
      assertJobAllowsFloorMutation(job.status);
    }

    return fn(tenantId, id, actorUserId);
  }

  cancel(
    tenantId: string,
    id: string,
    actorUserId?: string,
    reason?: string,
  ) {
    return this.lifecycleService.cancel(tenantId, id, actorUserId, reason);
  }

  private async validateCustomerCompanyId(
    tenantId: string,
    customerCompanyId?: string | null,
  ) {
    if (!customerCompanyId) return;

    const company = await this.prisma.customer_companies.findFirst({
      where: { id: customerCompanyId, tenantId },
      select: { id: true },
    });

    if (!company) {
      throw new BadRequestException('Customer company not found in this tenant');
    }
  }

  private async validateInventoryBatchId(
    tenantId: string,
    inventoryBatchId?: string | null,
  ) {
    if (!inventoryBatchId) return;

    const batch = await this.prisma.inventory_batches.findFirst({
      where: { id: inventoryBatchId, tenantId },
      select: { id: true },
    });

    if (!batch) {
      throw new BadRequestException('Inventory batch not found in this tenant');
    }
  }

  private async validateAssignedToUserId(
    tenantId: string,
    assignedToUserId?: string | null,
  ) {
    if (!assignedToUserId) return;

    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        tenantId,
        userId: assignedToUserId,
        status: MembershipStatus.Active,
      },
      select: { role: true },
    });

    if (
      !membership ||
      !WAREHOUSE_JOB_WAREHOUSE_IN_CHARGE_ROLES.has(membership.role)
    ) {
      throw new BadRequestException(WAREHOUSE_IN_CHARGE_VALIDATION_MESSAGE);
    }
  }

  private async validateCsInChargeUserId(
    tenantId: string,
    csInChargeUserId?: string | null,
  ) {
    if (!csInChargeUserId) return;

    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        tenantId,
        userId: csInChargeUserId,
        status: MembershipStatus.Active,
      },
      select: { role: true },
    });

    if (
      !membership ||
      !WAREHOUSE_JOB_CS_IN_CHARGE_ROLES.has(membership.role)
    ) {
      throw new BadRequestException(CS_IN_CHARGE_VALIDATION_MESSAGE);
    }
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Role,
  WarehouseJobDocumentReviewStatus,
  WarehouseJobDocumentSource,
  WarehouseJobDocumentType,
  WarehouseJobEventType,
} from '@prisma/client';
import { WarehouseJobAccessRef } from './warehouse-job-access';
import { SupabaseService } from '../../shared/auth/supabase.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { WarehouseJobEventsService } from './warehouse-job-events.service';
import {
  assertWarehouseUserCanAccessJob,
  assertJobAllowsFloorMutation,
  isOpsLikeRole,
  mapRoleToDocumentSource,
  WAREHOUSE_UPLOAD_TYPES,
} from './warehouse-job-access';
import {
  assertAllowedWarehouseJobDocumentFile,
  buildWarehouseJobDocumentStorageKey,
  createWarehouseJobDocumentSignedUrl,
  uploadWarehouseJobDocument,
} from './warehouse-job-document-storage';
import {
  RejectWarehouseJobDocumentDto,
  UpdateWarehouseJobDocumentDto,
} from './dto/warehouse-job-document.dto';

const documentInclude = {
  uploadedByUser: { select: { id: true, name: true, email: true } },
  reviewedByUser: { select: { id: true, name: true, email: true } },
} satisfies Prisma.WarehouseJobDocumentInclude;

@Injectable()
export class WarehouseJobDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly eventsService: WarehouseJobEventsService,
  ) {}

  async list(
    tenantId: string,
    warehouseJobId: string,
    actorRole: Role,
    actorUserId?: string,
  ) {
    const job = await this.findJobOrThrow(tenantId, warehouseJobId);
    this.assertCanViewJob(job, actorRole, actorUserId);

    const documents = await this.prisma.warehouseJobDocument.findMany({
      where: { tenantId, warehouseJobId },
      orderBy: [{ createdAt: 'desc' }],
      include: documentInclude,
    });

    return Promise.all(documents.map((doc) => this.attachSignedUrl(doc)));
  }

  async upload(
    tenantId: string,
    warehouseJobId: string,
    type: WarehouseJobDocumentType,
    file: Express.Multer.File,
    actorRole: Role,
    actorUserId: string | undefined,
    notes?: string,
  ) {
    assertAllowedWarehouseJobDocumentFile(file);
    this.assertCanUploadType(type, actorRole);

    if (!actorUserId) {
      throw new ForbiddenException('User context required to upload documents');
    }

    const job = await this.findJobOrThrow(tenantId, warehouseJobId);
    if (actorRole === Role.WAREHOUSE) {
      assertWarehouseUserCanAccessJob(job, actorUserId);
      assertJobAllowsFloorMutation(job.status);
    }

    const source = mapRoleToDocumentSource(actorRole) as WarehouseJobDocumentSource;
    const originalName = file.originalname ?? 'upload';
    const storageKey = buildWarehouseJobDocumentStorageKey(
      tenantId,
      warehouseJobId,
      type,
      originalName,
    );

    await uploadWarehouseJobDocument(this.supabaseService, storageKey, file);

    const doc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.warehouseJobDocument.create({
        data: {
          tenantId,
          warehouseJobId,
          uploadedByUserId: actorUserId,
          type,
          source,
          reviewStatus: WarehouseJobDocumentReviewStatus.PENDING_REVIEW,
          originalName,
          fileName: originalName,
          mimeType: file.mimetype ?? 'application/octet-stream',
          sizeBytes: file.size ?? null,
          storageKey,
          notes: notes?.trim() || null,
        },
        include: documentInclude,
      });

      await this.eventsService.append(tx, {
        tenantId,
        warehouseJobId,
        actorUserId,
        eventType: WarehouseJobEventType.DOCUMENT_UPLOADED,
        payload: {
          documentId: created.id,
          type,
          source,
        },
      });

      return created;
    });

    return this.attachSignedUrl(doc);
  }

  async updateMetadata(
    tenantId: string,
    warehouseJobId: string,
    documentId: string,
    dto: UpdateWarehouseJobDocumentDto,
    actorUserId?: string,
  ) {
    const doc = await this.findDocumentOrThrow(
      tenantId,
      warehouseJobId,
      documentId,
    );

    const data: Prisma.WarehouseJobDocumentUpdateInput = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.notes !== undefined) data.notes = dto.notes.trim() || null;

    if (Object.keys(data).length === 0) {
      return this.attachSignedUrl(doc);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.warehouseJobDocument.update({
        where: { id: doc.id },
        data,
        include: documentInclude,
      });

      await this.eventsService.append(tx, {
        tenantId,
        warehouseJobId,
        actorUserId,
        eventType: WarehouseJobEventType.DOCUMENT_UPDATED,
        payload: {
          documentId: doc.id,
          changedFields: dto,
        } as unknown as Prisma.InputJsonValue,
      });

      return row;
    });

    return this.attachSignedUrl(updated);
  }

  async delete(
    tenantId: string,
    warehouseJobId: string,
    documentId: string,
    actorUserId?: string,
  ) {
    const doc = await this.findDocumentOrThrow(
      tenantId,
      warehouseJobId,
      documentId,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.warehouseJobDocument.delete({ where: { id: doc.id } });
      await this.eventsService.append(tx, {
        tenantId,
        warehouseJobId,
        actorUserId,
        eventType: WarehouseJobEventType.DOCUMENT_DELETED,
        payload: {
          documentId: doc.id,
          type: doc.type,
        },
      });
    });

    return { deleted: true };
  }

  async approve(
    tenantId: string,
    warehouseJobId: string,
    documentId: string,
    actorUserId?: string,
  ) {
    const doc = await this.findDocumentOrThrow(
      tenantId,
      warehouseJobId,
      documentId,
    );

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.warehouseJobDocument.update({
        where: { id: doc.id },
        data: {
          reviewStatus: WarehouseJobDocumentReviewStatus.APPROVED,
          reviewedByUserId: actorUserId ?? null,
          reviewedAt: now,
          rejectedReason: null,
        },
        include: documentInclude,
      });

      await this.eventsService.append(tx, {
        tenantId,
        warehouseJobId,
        actorUserId,
        eventType: WarehouseJobEventType.DOCUMENT_APPROVED,
        payload: { documentId: doc.id },
      });

      return row;
    });

    return this.attachSignedUrl(updated);
  }

  async reject(
    tenantId: string,
    warehouseJobId: string,
    documentId: string,
    dto: RejectWarehouseJobDocumentDto,
    actorUserId?: string,
  ) {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('reason is required');
    }

    const doc = await this.findDocumentOrThrow(
      tenantId,
      warehouseJobId,
      documentId,
    );

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.warehouseJobDocument.update({
        where: { id: doc.id },
        data: {
          reviewStatus: WarehouseJobDocumentReviewStatus.REJECTED,
          reviewedByUserId: actorUserId ?? null,
          reviewedAt: now,
          rejectedReason: reason,
        },
        include: documentInclude,
      });

      await this.eventsService.append(tx, {
        tenantId,
        warehouseJobId,
        actorUserId,
        eventType: WarehouseJobEventType.DOCUMENT_REJECTED,
        payload: { documentId: doc.id, reason },
      });

      return row;
    });

    return this.attachSignedUrl(updated);
  }

  async getSignedUrl(
    tenantId: string,
    warehouseJobId: string,
    documentId: string,
    actorRole: Role,
    actorUserId?: string,
  ) {
    const job = await this.findJobOrThrow(tenantId, warehouseJobId);
    this.assertCanViewJob(job, actorRole, actorUserId);

    const doc = await this.findDocumentOrThrow(
      tenantId,
      warehouseJobId,
      documentId,
    );

    const signedUrl = await createWarehouseJobDocumentSignedUrl(
      this.supabaseService,
      doc.storageKey,
    );

    return {
      previewUrl: signedUrl,
      downloadUrl: signedUrl,
      expiresInSeconds: 60 * 60,
    };
  }

  async countDocumentsByReviewStatus(
    tenantId: string,
    warehouseJobIds: string[],
  ): Promise<
    Map<
      string,
      {
        totalDocuments: number;
        pendingReviewDocuments: number;
        approvedDocuments: number;
        rejectedDocuments: number;
      }
    >
  > {
    const result = new Map<
      string,
      {
        totalDocuments: number;
        pendingReviewDocuments: number;
        approvedDocuments: number;
        rejectedDocuments: number;
      }
    >();

    if (warehouseJobIds.length === 0) return result;

    const rows = await this.prisma.warehouseJobDocument.groupBy({
      by: ['warehouseJobId', 'reviewStatus'],
      where: { tenantId, warehouseJobId: { in: warehouseJobIds } },
      _count: { _all: true },
    });

    for (const jobId of warehouseJobIds) {
      result.set(jobId, {
        totalDocuments: 0,
        pendingReviewDocuments: 0,
        approvedDocuments: 0,
        rejectedDocuments: 0,
      });
    }

    for (const row of rows) {
      const counts = result.get(row.warehouseJobId)!;
      const n = row._count._all;
      counts.totalDocuments += n;
      if (row.reviewStatus === WarehouseJobDocumentReviewStatus.PENDING_REVIEW) {
        counts.pendingReviewDocuments += n;
      } else if (row.reviewStatus === WarehouseJobDocumentReviewStatus.APPROVED) {
        counts.approvedDocuments += n;
      } else if (row.reviewStatus === WarehouseJobDocumentReviewStatus.REJECTED) {
        counts.rejectedDocuments += n;
      }
    }

    return result;
  }

  private assertCanUploadType(type: WarehouseJobDocumentType, role: Role): void {
    if (isOpsLikeRole(role)) return;

    if (role === Role.WAREHOUSE) {
      if (!WAREHOUSE_UPLOAD_TYPES.has(type)) {
        throw new ForbiddenException(
          `Warehouse users cannot upload document type ${type}`,
        );
      }
      return;
    }

    throw new ForbiddenException('Insufficient role to upload documents');
  }

  private assertCanViewJob(
    job: WarehouseJobAccessRef,
    role: Role,
    userId?: string,
  ): void {
    if (isOpsLikeRole(role)) return;
    if (role === Role.WAREHOUSE) {
      assertWarehouseUserCanAccessJob(job, userId);
      return;
    }
    throw new ForbiddenException('Insufficient role to view warehouse job documents');
  }

  private async findJobOrThrow(tenantId: string, warehouseJobId: string) {
    const job = await this.prisma.warehouseJob.findFirst({
      where: { id: warehouseJobId, tenantId },
      select: {
        id: true,
        status: true,
        assignedToUserId: true,
      },
    });

    if (!job) {
      throw new NotFoundException('Warehouse job not found');
    }

    return job;
  }

  private async findDocumentOrThrow(
    tenantId: string,
    warehouseJobId: string,
    documentId: string,
  ) {
    const doc = await this.prisma.warehouseJobDocument.findFirst({
      where: { id: documentId, tenantId, warehouseJobId },
      include: documentInclude,
    });

    if (!doc) {
      throw new NotFoundException('Warehouse job document not found');
    }

    return doc;
  }

  private async attachSignedUrl<T extends { storageKey: string; url: string | null }>(
    doc: T,
  ): Promise<T & { url: string | null }> {
    const signedUrl = await createWarehouseJobDocumentSignedUrl(
      this.supabaseService,
      doc.storageKey,
    );
    return { ...doc, url: signedUrl ?? doc.url };
  }
}

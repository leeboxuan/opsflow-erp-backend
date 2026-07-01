import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  Role,
  WarehouseJobDocumentReviewStatus,
  WarehouseJobDocumentType,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { SupabaseService } from '../../shared/auth/supabase.service';
import { warehouseJobDetailInclude } from './warehouse-job-lifecycle.service';
import {
  assertWarehouseUserCanAccessJob,
  isOpsLikeRole,
  WarehouseJobAccessRef,
} from './warehouse-job-access';
import { createWarehouseJobDocumentSignedUrl } from './warehouse-job-document-storage';
import {
  computeWarehouseJobProgress,
  computeWarehouseJobReadiness,
} from './warehouse-job-report-readiness';

const documentInclude = {
  uploadedByUser: { select: { id: true, name: true, email: true } },
  reviewedByUser: { select: { id: true, name: true, email: true } },
} satisfies Prisma.WarehouseJobDocumentInclude;

const reportPreviewInclude = {
  ...warehouseJobDetailInclude,
  lines: {
    select: { requestedQty: true, completedQty: true },
  },
  documents: {
    orderBy: { createdAt: 'desc' as const },
    include: documentInclude,
  },
  units: {
    select: { linkStatus: true },
  },
} satisfies Prisma.WarehouseJobInclude;

export type WarehouseJobReportUserContext = {
  role: Role;
  userId?: string;
};

export type ReportPreviewDocument = {
  id: string;
  type: WarehouseJobDocumentType;
  source: string;
  reviewStatus: WarehouseJobDocumentReviewStatus;
  originalName: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  url: string | null;
  notes: string | null;
  rejectedReason: string | null;
  uploadedByUser: { id: string; name: string | null; email: string | null } | null;
  reviewedByUser: { id: string; name: string | null; email: string | null } | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

@Injectable()
export class WarehouseJobReportPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async getReportPreview(
    tenantId: string,
    userContext: WarehouseJobReportUserContext,
    warehouseJobId: string,
  ) {
    const job = await this.prisma.warehouseJob.findFirst({
      where: { id: warehouseJobId, tenantId },
      include: reportPreviewInclude,
    });

    if (!job) {
      throw new NotFoundException('Warehouse job not found');
    }

    this.assertCanViewPreview(job, userContext.role, userContext.userId);

    const documents = await Promise.all(
      job.documents.map((doc) => this.toReportDocument(doc)),
    );

    const progress = computeWarehouseJobProgress(job.lines, job.units);
    const readiness = computeWarehouseJobReadiness({
      status: job.status,
      containerNumber: job.containerNumber,
      sealNumber: job.sealNumber,
      warehouseNotes: job.warehouseNotes,
      documents: job.documents.map((doc) => ({
        type: doc.type,
        reviewStatus: doc.reviewStatus,
      })),
    });

    return {
      job: {
        id: job.id,
        internalRef: job.internalRef,
        type: job.type,
        status: job.status,
        priority: job.priority,
        title: job.title,
        description: job.description,
        notes: job.notes,
        containerNumber: job.containerNumber,
        sealNumber: job.sealNumber,
        warehouseNotes: job.warehouseNotes,
        scheduledAt: job.scheduledAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        cancelledAt: job.cancelledAt,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        customerCompany: job.customerCompany,
        inventoryBatch: job.inventoryBatch,
        assignedToUser: job.assignedToUser,
        createdByUser: job.createdByUser,
      },
      progress,
      documents: this.groupDocuments(documents),
      readiness,
      generatedAt: new Date(),
    };
  }

  private groupDocuments(documents: ReportPreviewDocument[]) {
    const byType = {} as Record<WarehouseJobDocumentType, ReportPreviewDocument[]>;
    const byReviewStatus = {} as Record<
      WarehouseJobDocumentReviewStatus,
      ReportPreviewDocument[]
    >;

    for (const type of Object.values(WarehouseJobDocumentType)) {
      byType[type] = [];
    }
    for (const status of Object.values(WarehouseJobDocumentReviewStatus)) {
      byReviewStatus[status] = [];
    }

    for (const doc of documents) {
      byType[doc.type].push(doc);
      byReviewStatus[doc.reviewStatus].push(doc);
    }

    return {
      all: documents,
      byType,
      byReviewStatus,
      packingLists: byType[WarehouseJobDocumentType.PACKING_LIST],
      deliveryOrders: byType[WarehouseJobDocumentType.DELIVERY_ORDER],
      instructions: byType[WarehouseJobDocumentType.INSTRUCTION],
      referencePhotos: byType[WarehouseJobDocumentType.REFERENCE_PHOTO],
      warehousePhotos: byType[WarehouseJobDocumentType.WAREHOUSE_PHOTO],
      damagePhotos: byType[WarehouseJobDocumentType.DAMAGE_PHOTO],
      completionPhotos: byType[WarehouseJobDocumentType.COMPLETION_PHOTO],
      others: byType[WarehouseJobDocumentType.OTHER],
    };
  }

  private async toReportDocument(
    doc: Prisma.WarehouseJobDocumentGetPayload<{ include: typeof documentInclude }>,
  ): Promise<ReportPreviewDocument> {
    const signedUrl = await createWarehouseJobDocumentSignedUrl(
      this.supabaseService,
      doc.storageKey,
    );

    return {
      id: doc.id,
      type: doc.type,
      source: doc.source,
      reviewStatus: doc.reviewStatus,
      originalName: doc.originalName,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      url: signedUrl ?? doc.url,
      notes: doc.notes,
      rejectedReason: doc.rejectedReason,
      uploadedByUser: doc.uploadedByUser,
      reviewedByUser: doc.reviewedByUser,
      reviewedAt: doc.reviewedAt,
      createdAt: doc.createdAt,
    };
  }

  private assertCanViewPreview(
    job: WarehouseJobAccessRef,
    role: Role,
    userId?: string,
  ): void {
    if (isOpsLikeRole(role)) return;

    if (role === Role.WAREHOUSE) {
      assertWarehouseUserCanAccessJob(job, userId);
      return;
    }

    throw new ForbiddenException(
      'Insufficient role to view warehouse job report preview',
    );
  }
}

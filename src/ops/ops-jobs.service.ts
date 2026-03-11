import * as fs from "fs";
import path from "path";

import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { JobStatus, JobType, JobDocumentType, Role } from "@prisma/client";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";

import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SupabaseService } from "../auth/supabase.service";
import {
  parsePaginationFromQuery,
  buildPaginationMeta,
  type PaginatedResponse,
} from "../common/pagination";
import { applyMappedFilter } from "../common/listing/listing.filters";
import { buildOrderBy } from "../common/listing/listing.sort";
import { applyQSearch } from "../common/listing/listing.search";

import { CreateJobDto } from "./dto/create-job.dto";
import { UpdateJobDto } from "./dto/update-job.dto";
import { AssignJobDto } from "./dto/assign-job.dto";
import { CancelJobDto } from "./dto/cancel-job.dto";
import { JobListQueryDto } from "./dto/job-list-query.dto";
import {
  JobDto,
  JobDocumentDto,
  JobTrackingDto,
  AuditLogEntryDto,
} from "./dto/job.dto";
import type {
  ImportJobRowDto,
  ImportPreviewRowDto,
  ImportConfirmRowDto,
} from "./dto/import-job-row.dto";
import type {
  LclImportPreviewRowDto,
  LclImportPreviewResponseDto,
  LclImportConfirmRequestDto,
  LclImportConfirmResponseDto,
} from "./dto/lcl-import.dto";

const JOB_DOCUMENTS_BUCKET = "job-documents";

const QUOTATION_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

const QUOTATION_EXT = /\.(pdf|xlsx|xls)$/i;

function toDocDto(d: any): JobDocumentDto {
  return {
    id: d.id,
    type: d.type,
    originalName: d.originalName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes ?? null,
    createdAt: d.createdAt,
    url: d.url ?? null,
  };
}

function normalizeExternalRef(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}


function toJobDto(j: any): JobDto {
  const assignedDriverName = j.assignedDriver
    ? (j.assignedDriver.name?.trim() || j.assignedDriver.email || null)
    : null;

  return {
    id: j.id,
    tenantId: j.tenantId,
    customerCompanyId: j.customerCompanyId,
    companyName: j.customerCompany?.name ?? null,

    internalRef: j.internalRef,
    externalRef: j.externalRef ?? null,
    jobType: j.jobType,
    status: j.status,
    notes: j.notes ?? null,

    pickupDate: j.pickupDate,
    pickupAddress1: j.pickupAddress1,
    pickupAddress2: j.pickupAddress2,
    pickupPostal: j.pickupPostal,
    pickupContactName: j.pickupContactName,
    pickupContactPhone: j.pickupContactPhone,

    deliveryAddress1: j.deliveryAddress1,
    deliveryAddress2: j.deliveryAddress2,
    deliveryPostal: j.deliveryPostal,
    receiverName: j.receiverName,
    receiverPhone: j.receiverPhone,

    assignedDriverId: j.assignedDriverId,
    assignedDriverName,
    assignedVehicleId: j.assignedVehicleId,
    assignedVehicleName: null,

    assignedAt: j.assignedAt,
    startedAt: j.startedAt,
    completedAt: j.completedAt,
    deliveredAt: j.deliveredAt,
    podRecipientName: j.podRecipientName,

    cancelledReason: j.cancelledReason,
    cancelledAt: j.cancelledAt,
    cancelledByUserId: j.cancelledByUserId,

    lastLat: j.lastLat,
    lastLng: j.lastLng,
    lastLocationAt: j.lastLocationAt,

    createdAt: j.createdAt,
    updatedAt: j.updatedAt,

    items:
      j.items?.map((item: any) => ({
        id: item.id,
        itemCode: item.itemCode,
        description: item.description ?? null,
        qty: item.qty,
      })) ?? [],

    documents: j.documents?.map((d: any) => toDocDto(d)) ?? [],
  };
}

@Injectable()
export class OpsJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly supabaseService: SupabaseService,
  ) {}

  private getJobTypeCode(jobType: JobType): string {
    switch (jobType) {
      case JobType.LCL:
        return "LCL";
      case JobType.IMPORT:
        return "IMP";
      case JobType.EXPORT:
        return "EXP";
      default:
        return "GEN";
    }
  }

  private async getNextInternalRef(
    tenantId: string,
    jobType: JobType,
  ): Promise<string> {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = now.getUTCMonth() + 1;
    const MM = String(mm).padStart(2, "0");
    const yyyymm = `${yyyy}-${MM}`;

    const row = await this.prisma.job_internal_ref_counters.upsert({
      where: {
        tenantId_yyyymm: { tenantId, yyyymm },
      },
      create: { tenantId, yyyymm, nextSeq: 1 },
      update: { nextSeq: { increment: 1 } },
      select: { nextSeq: true },
    });

    const seq = String(row.nextSeq).padStart(4, "0");
    const typeCode = this.getJobTypeCode(jobType);
    return `WF-${yyyy}-${MM}-${seq}-${typeCode}`;
  }

  private async attachSignedUrl(doc: any): Promise<JobDocumentDto> {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase.storage
      .from(JOB_DOCUMENTS_BUCKET)
      .createSignedUrl(doc.storageKey, 60 * 60);

    return {
      id: doc.id,
      type: doc.type,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes ?? null,
      createdAt: doc.createdAt,
      url: error ? null : data?.signedUrl ?? null,
    };
  }

  private async getLatestJobDocumentByType(
    tenantId: string,
    jobId: string,
    type: JobDocumentType,
  ) {
    return this.prisma.jobDocument.findFirst({
      where: {
        tenantId,
        jobId,
        type,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  private async deleteStorageObjectIfExists(storageKey: string | null | undefined) {
    if (!storageKey) return;

    const supabase = this.supabaseService.getClient();
    const { error } = await supabase.storage
      .from(JOB_DOCUMENTS_BUCKET)
      .remove([storageKey]);

    // Don't hard-fail if storage object is already gone.
    if (error) {
      console.warn(
        `[OpsJobsService] Failed to remove storage object ${storageKey}: ${error.message}`,
      );
    }
  }

  private async replaceJobDocumentByType(
    tenantId: string,
    jobId: string,
    type: JobDocumentType,
  ) {
    const existingDocs = await this.prisma.jobDocument.findMany({
      where: {
        tenantId,
        jobId,
        type,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!existingDocs.length) return null;

    await Promise.all(
      existingDocs.map((doc) => this.deleteStorageObjectIfExists(doc.storageKey)),
    );

    await this.prisma.jobDocument.deleteMany({
      where: {
        tenantId,
        jobId,
        type,
      },
    });

    return existingDocs[0] ?? null;
  }

  async list(
    tenantId: string,
    query: JobListQueryDto,
  ): Promise<PaginatedResponse<JobDto>> {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query);

    const where: any = { tenantId };

    if (query.status) {
      where.status = query.status as JobStatus;
    }

    if (query.companyId) {
      where.customerCompanyId = query.companyId;
    }

    if (query.pickupDateFrom || query.pickupDateTo) {
      where.pickupDate = {};
      if (query.pickupDateFrom) {
        where.pickupDate.gte = new Date(
          query.pickupDateFrom + "T00:00:00.000Z",
        );
      }
      if (query.pickupDateTo) {
        where.pickupDate.lte = new Date(
          query.pickupDateTo + "T23:59:59.999Z",
        );
      }
    }

    const q = (query.q ?? query.search)?.trim();
    applyQSearch(where, q, [
      "internalRef",
      "pickupAddress1",
      "deliveryAddress1",
      "receiverName",
      "receiverPhone",
      "externalRef",
    ]);

    applyMappedFilter(where, query.filter, {
      Draft: { status: JobStatus.Draft },
      Assigned: { status: JobStatus.Assigned },
      InProgress: { status: JobStatus.InProgress },
      PendingDepot: { status: JobStatus.PendingDepot },
      Completed: { status: JobStatus.Completed },
      Cancelled: { status: JobStatus.Cancelled },
    });

    if (query.status) {
      where.status = query.status as JobStatus;
    }

    const orderBy = buildOrderBy(
      query.sortBy,
      query.sortDir,
      [
        "createdAt",
        "updatedAt",
        "pickupDate",
        "internalRef",
        "externalRef",
        "status",
      ],
      { createdAt: "desc" },
    );

    const [total, jobs] = await this.prisma.$transaction([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          customerCompany: {
            select: { id: true, name: true },
          },
          assignedDriver: {
            select: { id: true, name: true, email: true },
          },
          items: {
            orderBy: { createdAt: "asc" },
          },
        },
      }),
    ]);

    return {
      data: jobs.map(toJobDto),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async create(
    tenantId: string,
    dto: CreateJobDto,
    actorUserId: string | null,
  ): Promise<JobDto> {
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: dto.customerCompanyId, tenantId },
    });

    if (!company) {
      throw new BadRequestException("Customer company not found");
    }

    const items = Array.isArray((dto as any).items) ? (dto as any).items : [];

    if (!items.length) {
      throw new BadRequestException("At least one item is required");
    }

    const validItems = items
      .filter((i: any) => i?.itemCode?.trim())
      .map((i: any) => ({
        itemCode: i.itemCode.trim(),
        description: i.description?.trim() || null,
        qty: Math.max(1, Number(i.qty) || 1),
      }));

    if (!validItems.length) {
      throw new BadRequestException("At least one valid item is required");
    }

    const internalRef = await this.getNextInternalRef(tenantId, dto.jobType);

    const job = await this.prisma.job.create({
      data: {
        tenantId,
        customerCompanyId: dto.customerCompanyId,
        internalRef,
        externalRef: normalizeExternalRef(dto.externalRef),
        jobType: dto.jobType,
        status: JobStatus.Draft,
        notes: dto.notes ?? null,
        pickupDate: dto.pickupDate ? new Date(dto.pickupDate) : null,
        pickupAddress1: dto.pickupAddress1,
        pickupAddress2: dto.pickupAddress2 ?? null,
        pickupPostal: dto.pickupPostal ?? null,
        pickupContactName: dto.pickupContactName ?? null,
        pickupContactPhone: dto.pickupContactPhone ?? null,
        deliveryAddress1: dto.deliveryAddress1,
        deliveryAddress2: dto.deliveryAddress2 ?? null,
        deliveryPostal: dto.deliveryPostal ?? null,
        receiverName: dto.receiverName,
        receiverPhone: dto.receiverPhone,
        items: {
          create: validItems.map((item: any) => ({
            tenantId,
            itemCode: item.itemCode,
            description: item.description,
            qty: item.qty,
          })),
        },
      },
      include: {
        customerCompany: {
          select: { id: true, name: true },
        },
        assignedDriver: {
          select: { id: true, name: true, email: true },
        },
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    await this.audit.log(
      tenantId,
      "CREATE",
      "JOB",
      job.id,
      { internalRef: job.internalRef, externalRef: job.externalRef },
      actorUserId,
    );

    // Best-effort auto-generate DO after job creation.
    // We do not fail the whole job creation if document generation/storage fails.
    try {
      await this.generateDoDocument(tenantId, job.id, actorUserId);
    } catch (error: any) {
      console.error(
        `[OpsJobsService] Auto-generate DO failed for job ${job.id}:`,
        error?.message ?? error,
      );
    }

    const freshJob = await this.prisma.job.findFirst({
      where: { id: job.id, tenantId },
      include: {
        customerCompany: {
          select: { id: true, name: true },
        },
        assignedDriver: {
          select: { id: true, name: true, email: true },
        },
        items: {
          orderBy: { createdAt: "asc" },
        },
        documents: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!freshJob) {
      throw new NotFoundException("Job not found after creation");
    }

    const jobDto = toJobDto(freshJob);

    if (freshJob.documents?.length) {
      jobDto.documents = await Promise.all(
        freshJob.documents.map((doc: any) => this.attachSignedUrl(doc)),
      );
    }
    
    return jobDto;

  }

  async getOne(tenantId: string, jobId: string): Promise<JobDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      include: {
        customerCompany: {
          select: { id: true, name: true },
        },
        assignedDriver: {
          select: { id: true, name: true, email: true },
        },
        items: {
          orderBy: { createdAt: "asc" },
        },
        documents: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!job) {
      throw new NotFoundException("Job not found");
    }

    const dto = toJobDto(job);

    if (!job.documents?.length) return dto;

    dto.documents = await Promise.all(
      job.documents.map((doc: any) => this.attachSignedUrl(doc)),
    );

    return dto;
  }

  async update(
    tenantId: string,
    jobId: string,
    dto: UpdateJobDto,
    actorUserId: string | null,
  ): Promise<JobDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) throw new NotFoundException("Job not found");

    if (
      job.status === JobStatus.Completed ||
      job.status === JobStatus.Cancelled
    ) {
      throw new BadRequestException(
        "Cannot edit job in Completed or Cancelled status",
      );
    }

    if (dto.customerCompanyId !== undefined) {
      const company = await this.prisma.customer_companies.findFirst({
        where: { id: dto.customerCompanyId, tenantId },
      });
      if (!company) {
        throw new BadRequestException("Customer company not found");
      }
    }

    const data: any = {};

    if (dto.jobType !== undefined) data.jobType = dto.jobType;
    if (dto.customerCompanyId !== undefined) {
      data.customerCompanyId = dto.customerCompanyId;
    }
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.pickupDate !== undefined) {
      data.pickupDate = dto.pickupDate ? new Date(dto.pickupDate) : null;
    }
    if (dto.pickupAddress1 !== undefined) data.pickupAddress1 = dto.pickupAddress1;
    if (dto.pickupAddress2 !== undefined) data.pickupAddress2 = dto.pickupAddress2;
    if (dto.pickupPostal !== undefined) data.pickupPostal = dto.pickupPostal;
    if (dto.pickupContactName !== undefined) {
      data.pickupContactName = dto.pickupContactName;
    }
    if (dto.pickupContactPhone !== undefined) {
      data.pickupContactPhone = dto.pickupContactPhone;
    }
    if (dto.deliveryAddress1 !== undefined) {
      data.deliveryAddress1 = dto.deliveryAddress1;
    }
    if (dto.deliveryAddress2 !== undefined) {
      data.deliveryAddress2 = dto.deliveryAddress2;
    }
    if (dto.deliveryPostal !== undefined) data.deliveryPostal = dto.deliveryPostal;
    if (dto.receiverName !== undefined) data.receiverName = dto.receiverName;
    if (dto.receiverPhone !== undefined) data.receiverPhone = dto.receiverPhone;
    if (dto.externalRef !== undefined) {
      data.externalRef = normalizeExternalRef(dto.externalRef);
    }

    const inputItems = Array.isArray((dto as any).items) ? (dto as any).items : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedJob = await tx.job.update({
        where: { id: jobId },
        data,
      });

      if (inputItems !== null) {
        const validItems = inputItems
          .filter((i: any) => i?.itemCode?.trim())
          .map((i: any) => ({
            itemCode: i.itemCode.trim(),
            description: i.description?.trim() || null,
            qty: Math.max(1, Number(i.qty) || 1),
          }));

        if (!validItems.length) {
          throw new BadRequestException("At least one valid item is required");
        }

        await tx.jobItem.deleteMany({
          where: { tenantId, jobId },
        });

        await tx.jobItem.createMany({
          data: validItems.map((item: any) => ({
            tenantId,
            jobId,
            itemCode: item.itemCode,
            description: item.description,
            qty: item.qty,
          })),
        });
      }

      return tx.job.findFirst({
        where: { id: updatedJob.id, tenantId },
        include: {
          customerCompany: {
            select: { id: true, name: true },
          },
          assignedDriver: {
            select: { id: true, name: true, email: true },
          },
          items: {
            orderBy: { createdAt: "asc" },
          },
        },
      });
    });

    await this.audit.log(
      tenantId,
      "UPDATE",
      "JOB",
      jobId,
      { changedFields: [...Object.keys(data), ...(inputItems ? ["items"] : [])] },
      actorUserId,
    );

    if (!updated) {
      throw new NotFoundException("Job not found after update");
    }

    return toJobDto(updated);
  }

  async assign(
    tenantId: string,
    jobId: string,
    dto: AssignJobDto,
    actorUserId: string | null,
  ): Promise<JobDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) throw new NotFoundException("Job not found");

    if (job.status !== JobStatus.Draft && job.status !== JobStatus.Assigned) {
      throw new BadRequestException("Job must be Draft or Assigned to assign");
    }

    if (job.startedAt) {
      throw new BadRequestException("Cannot reassign job that has been started");
    }

    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        tenantId,
        userId: dto.driverId,
        role: Role.DRIVER,
      },
    });

    if (!membership) {
      throw new BadRequestException(
        "Driver not found or not a DRIVER in this tenant",
      );
    }

    let vehicleId: string | null = dto.vehicleId ?? null;

    if (!vehicleId) {
      const driver = await this.prisma.drivers.findFirst({
        where: { tenantId, userId: dto.driverId },
        select: { defaultVehicleId: true },
      });

      if (!driver?.defaultVehicleId) {
        throw new BadRequestException(
          "Driver has no default vehicle; provide vehicleId",
        );
      }

      vehicleId = driver.defaultVehicleId;
    } else {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: vehicleId, tenantId },
      });

      if (!vehicle) {
        throw new BadRequestException("Vehicle not found");
      }
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        assignedDriverId: dto.driverId,
        assignedVehicleId: vehicleId,
        assignedAt: new Date(),
        status: JobStatus.Assigned,
      },
      include: {
        customerCompany: {
          select: { id: true, name: true },
        },
        assignedDriver: {
          select: { id: true, name: true, email: true },
        },
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    await this.audit.log(
      tenantId,
      "ASSIGN",
      "JOB",
      jobId,
      { driverId: dto.driverId, vehicleId },
      actorUserId,
    );

    return toJobDto(updated);
  }

  async cancel(
    tenantId: string,
    jobId: string,
    dto: CancelJobDto,
    actorUserId: string | null,
  ): Promise<JobDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) throw new NotFoundException("Job not found");

    if (job.status === JobStatus.Completed) {
      throw new BadRequestException("Cannot cancel a Completed job");
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.Cancelled,
        cancelledAt: new Date(),
        cancelledReason: dto.reason,
        cancelledByUserId: actorUserId ?? null,
      },
      include: {
        customerCompany: {
          select: { id: true, name: true },
        },
        assignedDriver: {
          select: { id: true, name: true, email: true },
        },
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    await this.audit.log(
      tenantId,
      "CANCEL",
      "JOB",
      jobId,
      { reason: dto.reason },
      actorUserId,
    );

    return toJobDto(updated);
  }

  async delete(
    tenantId: string,
    jobId: string,
    actorUserId: string | null,
  ): Promise<void> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) throw new NotFoundException("Job not found");

    const canDelete =
      job.status === JobStatus.Draft ||
      (job.status === JobStatus.Assigned &&
        !job.startedAt &&
        !job.assignedDriverId);

    if (!canDelete) {
      throw new BadRequestException(
        "Job cannot be deleted; cancel it with a reason.",
      );
    }

    await this.prisma.job.delete({
      where: { id: jobId },
    });

    await this.audit.log(tenantId, "DELETE", "JOB", jobId, {}, actorUserId);
  }

  async verifyDepot(
    tenantId: string,
    jobId: string,
    actorUserId: string | null,
  ): Promise<JobDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) throw new NotFoundException("Job not found");

    if (job.jobType === JobType.LCL) {
      throw new BadRequestException(
        "Verify depot only applies to IMPORT/EXPORT jobs",
      );
    }

    if (job.status !== JobStatus.PendingDepot) {
      throw new BadRequestException("Job must be in PendingDepot status");
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.Completed,
        completedAt: job.completedAt ?? new Date(),
      },
      include: {
        customerCompany: {
          select: { id: true, name: true },
        },
        assignedDriver: {
          select: { id: true, name: true, email: true },
        },
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    await this.audit.log(
      tenantId,
      "DEPOT_VERIFY",
      "JOB",
      jobId,
      {},
      actorUserId,
    );

    return toJobDto(updated);
  }

  async uploadQuotation(
    tenantId: string,
    jobId: string,
    file: Express.Multer.File,
    actorUserId: string | null,
  ): Promise<JobDocumentDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) throw new NotFoundException("Job not found");

    const mime = String(file.mimetype ?? "").toLowerCase();
    const name = (file.originalname ?? "").toLowerCase();
    const allowedMime =
      QUOTATION_MIMES.some((m) => mime === m) || QUOTATION_EXT.test(name);

    if (!allowedMime) {
      throw new BadRequestException(
        "Quotation must be PDF, XLSX, or XLS. Got: " +
          (mime || file.originalname || "unknown"),
      );
    }

    const previousQuotation = await this.replaceJobDocumentByType(
      tenantId,
      jobId,
      JobDocumentType.QUOTATION,
    );

    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".pdf";
    const key = `${tenantId}/jobs/${jobId}/quotation/${Date.now()}${ext}`;

    const supabase = this.supabaseService.getClient();
    const { error } = await supabase.storage
      .from(JOB_DOCUMENTS_BUCKET)
      .upload(key, file.buffer, {
        contentType: file.mimetype ?? "application/octet-stream",
        upsert: false,
      });

    if (error) {
      throw new BadRequestException(`Storage upload failed: ${error.message}`);
    }

    const doc = await this.prisma.jobDocument.create({
      data: {
        tenantId,
        jobId,
        type: JobDocumentType.QUOTATION,
        storageKey: key,
        originalName: file.originalname ?? "quotation",
        mimeType: file.mimetype ?? "application/octet-stream",
        sizeBytes: file.size ?? null,
        uploadedByUserId: actorUserId ?? null,
      },
    });

    await this.audit.log(
      tenantId,
      previousQuotation ? "REPLACE_DOC" : "UPLOAD_DOC",
      "JOB",
      jobId,
      {
        documentId: doc.id,
        previousDocumentId: previousQuotation?.id ?? null,
        type: "QUOTATION",
      },
      actorUserId,
    );

    return this.attachSignedUrl(doc);
  }

  async generateDoDocument(
    tenantId: string,
    jobId: string,
    userId?: string | null,
  ) {
    const job = await this.prisma.job.findFirst({
      where: {
        id: jobId,
        tenantId,
      },
      include: {
        customerCompany: true,
        assignedDriver: true,
        items: {
          orderBy: { createdAt: "asc" },
        },
        documents: true,
      },
    });

    if (!job) {
      throw new NotFoundException("Job not found");
    }

    if (!job.items?.length) {
      throw new BadRequestException("Add at least one item before generating DO");
    }

    const previousDo = await this.replaceJobDocumentByType(
      tenantId,
      jobId,
      JobDocumentType.DO,
    );

    const pdfBuffer = await this.buildDoPdfBuffer(job);

    const refForFile =
      job.externalRef?.trim() || job.internalRef?.trim() || job.id;

    const safeRef = this.safeFileName(refForFile);
    const fileName = `${safeRef}_DO.pdf`;
    const storageKey = `${tenantId}/jobs/${jobId}/do/${Date.now()}-${fileName}`;

    const { error: uploadError } = await this.supabaseService
      .getClient()
      .storage.from(JOB_DOCUMENTS_BUCKET)
      .upload(storageKey, pdfBuffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      throw new BadRequestException(
        `Failed to upload DO PDF: ${uploadError.message}`,
      );
    }

    const doc = await this.prisma.jobDocument.create({
      data: {
        tenantId,
        jobId,
        type: JobDocumentType.DO,
        storageKey,
        originalName: fileName,
        mimeType: "application/pdf",
        sizeBytes: pdfBuffer.length,
        uploadedByUserId: userId ?? null,
      },
    });

    await this.audit.log(
      tenantId,
      previousDo ? "REPLACE_DOC" : "GENERATE_DOC",
      "JOB",
      jobId,
      {
        documentId: doc.id,
        previousDocumentId: previousDo?.id ?? null,
        type: "DO",
        storageKey,
        originalName: doc.originalName,
        internalRef: job.internalRef,
        externalRef: job.externalRef,
      },
      userId ?? null,
    );

    return this.attachSignedUrl(doc);
  }
  
  async listDocuments(
    tenantId: string,
    jobId: string,
  ): Promise<JobDocumentDto[]> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) throw new NotFoundException("Job not found");

    const docs = await this.prisma.jobDocument.findMany({
      where: { tenantId, jobId },
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(docs.map((doc) => this.attachSignedUrl(doc)));
  }

  async getAudit(
    tenantId: string,
    jobId: string,
    limit?: number,
  ): Promise<AuditLogEntryDto[]> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) throw new NotFoundException("Job not found");

    const entries = await this.audit.findByEntity(
      tenantId,
      "JOB",
      jobId,
      limit ?? 100,
    );

    return entries.map((e) => ({
      id: e.id,
      actorUserId: e.actorUserId,
      entityType: e.entityType,
      entityId: e.entityId,
      action: e.action,
      metadata: e.metadata as Record<string, unknown> | null,
      createdAt: e.createdAt,
    }));
  }

  async getTracking(tenantId: string, jobId: string): Promise<JobTrackingDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      select: {
        lastLat: true,
        lastLng: true,
        lastLocationAt: true,
        assignedDriverId: true,
        assignedVehicleId: true,
        status: true,
      },
    });

    if (!job) throw new NotFoundException("Job not found");

    return {
      lastLat: job.lastLat,
      lastLng: job.lastLng,
      lastLocationAt: job.lastLocationAt,
      assignedDriverId: job.assignedDriverId,
      assignedVehicleId: job.assignedVehicleId,
      status: job.status,
    };
  }

  /**
   * Parse Excel into typed rows. No DB writes.
   * Column order:
   * 0=companyCode/companyId,
   * 1=jobType,
   * 2=pickupAddress,
   * 3=deliveryAddress,
   * 4=receiverName,
   * 5=receiverPhone,
   * 6=pickupDate,
   * 7=driverEmail (optional).
   */
  private parseExcelToRows(
    buffer: Buffer,
  ): { rowNumber: number; data: ImportJobRowDto }[] {
    let XLSX: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      XLSX = require("xlsx");
    } catch {
      throw new BadRequestException(
        "Excel import requires xlsx package (npm install xlsx)",
      );
    }

    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return [];

    const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
    });
    if (rawRows.length < 1) return [];

    const first = rawRows[0] as any[];
    const isHeaderRow =
      first?.some(
        (c) =>
          typeof c === "string" &&
          /company|job\s*type|pickup|delivery|receiver|date|driver/i.test(
            String(c),
          ),
      ) ?? false;

    const start = isHeaderRow ? 1 : 0;
    const out: { rowNumber: number; data: ImportJobRowDto }[] = [];

    const get = (row: any[], idx: number): string => {
      const v = row[idx];
      return v != null ? String(v).trim() : "";
    };

    for (let i = start; i < rawRows.length; i++) {
      const row = rawRows[i] as any[];
      if (!row || row.every((c) => c == null || String(c).trim() === "")) {
        continue;
      }

      const col0 = get(row, 0);
      const jobTypeStr = get(row, 1).toUpperCase();
      const pickupAddress = get(row, 2);
      const deliveryAddress = get(row, 3);
      const receiverName = get(row, 4);
      const receiverPhone = get(row, 5);
      const pickupDate = get(row, 6);
      const driverEmail = get(row, 7) || undefined;

      let jobType: JobType;
      if (jobTypeStr === "LCL") jobType = JobType.LCL;
      else if (jobTypeStr === "IMPORT") jobType = JobType.IMPORT;
      else if (jobTypeStr === "EXPORT") jobType = JobType.EXPORT;
      else jobType = JobType.LCL;

      const data: ImportJobRowDto = {
        jobType,
        pickupAddress,
        deliveryAddress,
        receiverName,
        receiverPhone,
        pickupDate: pickupDate || "",
      } as ImportJobRowDto;

      if (col0) {
        if (/^c[a-z0-9]{24}$/i.test(col0)) (data as any).companyId = col0;
        else (data as any).companyCode = col0;
      }

      if (driverEmail) (data as any).driverEmail = driverEmail;

      out.push({ rowNumber: i + 1, data });
    }

    return out;
  }

  private async validateAndResolveRow(
    tenantId: string,
    row: ImportJobRowDto | ImportConfirmRowDto,
  ): Promise<{
    errors: string[];
    customerCompanyId?: string;
    driverId?: string;
  }> {
    const errors: string[] = [];
    const companyCode = (row as any).companyCode?.trim();
    const companyId = (row as any).companyId?.trim();

    if (!companyCode && !companyId) {
      errors.push("companyCode or companyId is required");
    }

    const jobType = row.jobType;
    if (!jobType || !["LCL", "IMPORT", "EXPORT"].includes(jobType)) {
      errors.push("jobType must be LCL, IMPORT, or EXPORT");
    }
    if (!row.pickupAddress?.trim()) errors.push("pickupAddress is required");
    if (!row.deliveryAddress?.trim()) errors.push("deliveryAddress is required");
    if (!row.receiverName?.trim()) errors.push("receiverName is required");
    if (!row.receiverPhone?.trim()) errors.push("receiverPhone is required");

    if (!row.pickupDate?.trim()) {
      errors.push("pickupDate is required");
    } else {
      const d = new Date(row.pickupDate);
      if (Number.isNaN(d.getTime())) {
        errors.push("pickupDate must be a valid date (YYYY-MM-DD)");
      }
    }

    let customerCompanyId: string | undefined;
    if (companyId && /^c[a-z0-9]{24}$/i.test(companyId)) {
      const company = await this.prisma.customer_companies.findFirst({
        where: { id: companyId, tenantId },
      });
      if (company) customerCompanyId = company.id;
      else errors.push(`Company not found for id: ${companyId}`);
    } else if (companyCode) {
      const normalizedName = companyCode.trim().toLowerCase().replace(/\s+/g, " ");
      const company = await this.prisma.customer_companies.findFirst({
        where: { tenantId, normalizedName },
      });
      if (company) customerCompanyId = company.id;
      else errors.push(`Company not found for: ${companyCode}`);
    }

    let driverId: string | undefined;
    const driverEmail = (row as any).driverEmail?.trim();
    if (driverEmail) {
      const membership = await this.prisma.tenantMembership.findFirst({
        where: {
          tenantId,
          role: Role.DRIVER,
          user: { email: { equals: driverEmail, mode: "insensitive" } },
        },
        select: { userId: true },
      });
      if (membership) driverId = membership.userId;
      else errors.push(`Driver not found for email: ${driverEmail}`);
    }

    return { errors, customerCompanyId, driverId };
  }

  async importPreview(
    tenantId: string,
    buffer: Buffer,
  ): Promise<{ rows: ImportPreviewRowDto[] }> {
    const parsed = this.parseExcelToRows(buffer);
    const rows: ImportPreviewRowDto[] = [];

    for (const { rowNumber, data } of parsed) {
      const { errors, customerCompanyId, driverId } =
        await this.validateAndResolveRow(tenantId, data);

      rows.push({
        rowNumber,
        data,
        errors,
        ...(customerCompanyId && { customerCompanyId }),
        ...(driverId && { driverId }),
      });
    }

    return { rows };
  }

  async importConfirm(
    tenantId: string,
    requestRows: ImportConfirmRowDto[],
    actorUserId: string | null,
  ): Promise<{
    createdCount: number;
    failedRows: { rowNumber: number; reason: string }[];
  }> {
    const failedRows: { rowNumber: number; reason: string }[] = [];
    let createdCount = 0;

    for (let i = 0; i < requestRows.length; i++) {
      const row = requestRows[i];
      const rowNum = row.rowNumber ?? i + 1;

      const { errors, customerCompanyId, driverId } =
        await this.validateAndResolveRow(tenantId, row as ImportJobRowDto);

      if (errors.length > 0) {
        failedRows.push({ rowNumber: rowNum, reason: errors.join("; ") });
        continue;
      }

      if (!customerCompanyId) {
        failedRows.push({
          rowNumber: rowNum,
          reason: "Company could not be resolved",
        });
        continue;
      }

      const jobType =
        row.jobType === "LCL"
          ? JobType.LCL
          : row.jobType === "IMPORT"
            ? JobType.IMPORT
            : JobType.EXPORT;

      try {
        let assignedVehicleId: string | null = null;

        if (driverId) {
          const driver = await this.prisma.drivers.findFirst({
            where: { tenantId, userId: driverId },
            select: { defaultVehicleId: true },
          });
          assignedVehicleId = driver?.defaultVehicleId ?? null;
        }

        const internalRef = await this.getNextInternalRef(tenantId, jobType);

        const job = await this.prisma.job.create({
          data: {
            tenantId,
            customerCompanyId,
            internalRef,
            jobType,
            status: driverId ? JobStatus.Assigned : JobStatus.Draft,
            pickupDate: row.pickupDate ? new Date(row.pickupDate) : null,
            pickupAddress1: row.pickupAddress,
            pickupAddress2: (row as any).pickupAddress2 ?? null,
            pickupPostal: (row as any).pickupPostal ?? null,
            deliveryAddress1: row.deliveryAddress,
            deliveryAddress2: (row as any).deliveryAddress2 ?? null,
            deliveryPostal: (row as any).deliveryPostal ?? null,
            receiverName: row.receiverName,
            receiverPhone: row.receiverPhone,
            ...(driverId && {
              assignedDriverId: driverId,
              assignedAt: new Date(),
              assignedVehicleId,
            }),
            items: {
              create: [
                {
                  tenantId,
                  itemCode: "UNSPECIFIED",
                  description: "Imported job item",
                  qty: 1,
                },
              ],
            },
          },
        });

        createdCount++;

        await this.audit.log(
          tenantId,
          "CREATE",
          "JOB",
          job.id,
          {
            internalRef: job.internalRef,
            externalRef: job.externalRef,
            source: "import_confirm",
            row: rowNum,
          },
          actorUserId,
        );
      } catch (e: any) {
        failedRows.push({
          rowNumber: rowNum,
          reason: e?.message ?? "Create failed",
        });
      }
    }

    return { createdCount, failedRows };
  }

  private static LCL_HEADERS = [
    "Order Ref",
    "First Name",
    "Last Name",
    "Phone",
    "Mobile",
    "Delivery First Name",
    "Delivery Last Name",
    "Delivery Address 1",
    "Delivery Address 2",
    "Delivery City",
    "Delivery Postal Code",
    "Delivery Country",
    "Item Code",
    "Item Qty",
    "Special Request",
  ] as const;

  private static normalizePhone(v: unknown): string {
    if (v == null) return "";
    return String(v).replace(/\s+/g, " ").trim();
  }

  private static cell(row: any[], idx: number): string {
    const v = row[idx];
    if (v == null) return "";
    return String(v).replace(/\s+/g, " ").trim();
  }

  private parseLclExcel(buffer: Buffer): LclImportPreviewRowDto[] {
    let XLSX: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      XLSX = require("xlsx");
    } catch {
      throw new BadRequestException(
        "Excel import requires xlsx package (npm install xlsx)",
      );
    }

    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];

    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet) return [];

    const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
    });
    if (rawRows.length < 2) return [];

    const headerRow = rawRows[0] as string[];
    const col = (name: string): number => {
      const i = headerRow.findIndex(
        (h) => String(h || "").trim().toLowerCase() === name.toLowerCase(),
      );
      return i >= 0 ? i : -1;
    };

    const idx = {
      orderRef: col("Order Ref"),
      firstName: col("First Name"),
      lastName: col("Last Name"),
      phone: col("Phone"),
      mobile: col("Mobile"),
      deliveryFirstName: col("Delivery First Name"),
      deliveryLastName: col("Delivery Last Name"),
      deliveryAddress1: col("Delivery Address 1"),
      deliveryAddress2: col("Delivery Address 2"),
      deliveryCity: col("Delivery City"),
      deliveryPostalCode: col("Delivery Postal Code"),
      deliveryCountry: col("Delivery Country"),
      itemCode: col("Item Code"),
      itemQty: col("Item Qty"),
      specialRequest: col("Special Request"),
    };

    if (idx.orderRef < 0 || idx.deliveryAddress1 < 0) {
      throw new BadRequestException(
        "LCL template must have at least 'Order Ref' and 'Delivery Address 1' columns",
      );
    }

    const groups = new Map<
      string,
      {
        orderRef: string;
        firstName: string;
        lastName: string;
        phone: string;
        mobile: string;
        deliveryFirstName: string;
        deliveryLastName: string;
        deliveryAddress1: string;
        deliveryAddress2: string;
        deliveryCity: string;
        deliveryPostalCode: string;
        deliveryCountry: string;
        items: { code: string; qty: string }[];
        specialRequests: Set<string>;
      }
    >();

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i] as any[];
      if (!row || row.every((c) => c == null || String(c).trim() === "")) {
        continue;
      }

      const orderRef = OpsJobsService.cell(row, idx.orderRef);
      if (!orderRef) continue;

      const deliveryAddress1 = OpsJobsService.cell(row, idx.deliveryAddress1);
      const deliveryAddress2 =
        idx.deliveryAddress2 >= 0
          ? OpsJobsService.cell(row, idx.deliveryAddress2)
          : "";
      const deliveryCity =
        idx.deliveryCity >= 0 ? OpsJobsService.cell(row, idx.deliveryCity) : "";
      const deliveryPostalCode =
        idx.deliveryPostalCode >= 0
          ? OpsJobsService.cell(row, idx.deliveryPostalCode)
          : "";
      const deliveryCountry =
        idx.deliveryCountry >= 0
          ? OpsJobsService.cell(row, idx.deliveryCountry)
          : "";
      const deliveryFirstName =
        idx.deliveryFirstName >= 0
          ? OpsJobsService.cell(row, idx.deliveryFirstName)
          : "";
      const deliveryLastName =
        idx.deliveryLastName >= 0
          ? OpsJobsService.cell(row, idx.deliveryLastName)
          : "";
      const firstName =
        idx.firstName >= 0 ? OpsJobsService.cell(row, idx.firstName) : "";
      const lastName =
        idx.lastName >= 0 ? OpsJobsService.cell(row, idx.lastName) : "";
      const phone =
        idx.phone >= 0 ? OpsJobsService.normalizePhone(row[idx.phone]) : "";
      const mobile =
        idx.mobile >= 0 ? OpsJobsService.normalizePhone(row[idx.mobile]) : "";
      const itemCode =
        idx.itemCode >= 0 ? OpsJobsService.cell(row, idx.itemCode) : "";
      const itemQty =
        idx.itemQty >= 0 ? OpsJobsService.cell(row, idx.itemQty) : "";
      const specialRequest =
        idx.specialRequest >= 0
          ? OpsJobsService.cell(row, idx.specialRequest)
          : "";

      let g = groups.get(orderRef);
      if (!g) {
        g = {
          orderRef,
          firstName,
          lastName,
          phone,
          mobile,
          deliveryFirstName,
          deliveryLastName,
          deliveryAddress1,
          deliveryAddress2,
          deliveryCity,
          deliveryPostalCode,
          deliveryCountry,
          items: [],
          specialRequests: new Set(),
        };
        groups.set(orderRef, g);
      }

      if (itemCode) {
        g.items.push({ code: itemCode, qty: itemQty || "1" });
      }

      if (specialRequest) {
        g.specialRequests.add(specialRequest);
      }

      if (deliveryAddress1 && !g.deliveryAddress1) g.deliveryAddress1 = deliveryAddress1;
      if (deliveryAddress2 && !g.deliveryAddress2) g.deliveryAddress2 = deliveryAddress2;
      if (deliveryCity && !g.deliveryCity) g.deliveryCity = deliveryCity;
      if (deliveryPostalCode && !g.deliveryPostalCode) {
        g.deliveryPostalCode = deliveryPostalCode;
      }
      if (deliveryCountry && !g.deliveryCountry) g.deliveryCountry = deliveryCountry;
      if (deliveryFirstName && !g.deliveryFirstName) {
        g.deliveryFirstName = deliveryFirstName;
      }
      if (deliveryLastName && !g.deliveryLastName) g.deliveryLastName = deliveryLastName;
      if (firstName && !g.firstName) g.firstName = firstName;
      if (lastName && !g.lastName) g.lastName = lastName;
      if (phone && !g.phone) g.phone = phone;
      if (mobile && !g.mobile) g.mobile = mobile;
    }

    const result: LclImportPreviewRowDto[] = [];

    for (const g of groups.values()) {
      const receiverName =
        [g.deliveryFirstName, g.deliveryLastName].filter(Boolean).join(" ") ||
        [g.firstName, g.lastName].filter(Boolean).join(" ") ||
        "";

      const receiverPhone = g.mobile || g.phone || "";

      const itemsSummary =
        g.items.length > 0
          ? g.items.map((it) => `${it.code} x${it.qty}`).join("; ")
          : undefined;

      const specialRequest =
        g.specialRequests.size > 0
          ? [...g.specialRequests].filter(Boolean).join(" | ")
          : undefined;

      result.push({
        rowKey: g.orderRef,
        externalRef: g.orderRef,
        receiverName,
        receiverPhone,
        deliveryAddress1: g.deliveryAddress1,
        deliveryAddress2: g.deliveryAddress2 || undefined,
        deliveryPostal: g.deliveryPostalCode || undefined,
        deliveryCity: g.deliveryCity || undefined,
        deliveryCountry: g.deliveryCountry || undefined,
        itemsSummary,
        specialRequest,
        errors: [],
      });
    }

    return result;
  }

  private validateLclRow(
    row: LclImportPreviewRowDto,
    pickup: {
      customerCompanyId: string;
      pickupDate: string;
      pickupAddress1: string;
      pickupContactPhone?: string;
    },
  ): string[] {
    const errors: string[] = [];

    if (!pickup.customerCompanyId) errors.push("customerCompanyId is required");
    if (!pickup.pickupDate?.trim()) errors.push("pickupDate is required");
    if (!pickup.pickupAddress1?.trim()) errors.push("pickupAddress1 is required");
    if (!row.deliveryAddress1?.trim()) errors.push("deliveryAddress1 is required");

    const receiverName = (row.receiverName || "").trim();
    if (!receiverName) errors.push("receiverName is required");

    const receiverPhone =
      (row.receiverPhone || "").trim() ||
      (pickup.pickupContactPhone || "").trim();

    if (!receiverPhone) {
      errors.push(
        "receiverPhone is required (or set pickupContactPhone as default)",
      );
    }

    return errors;
  }

  async lclImportPreview(
    tenantId: string,
    buffer: Buffer,
    params: {
      customerCompanyId: string;
      pickupDate: string;
      pickupAddress1: string;
      pickupAddress2?: string;
      pickupPostal?: string;
      pickupContactName?: string;
      pickupContactPhone?: string;
    },
  ): Promise<LclImportPreviewResponseDto> {
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: params.customerCompanyId, tenantId },
    });

    if (!company) {
      throw new BadRequestException(
        "Customer company not found or does not belong to tenant",
      );
    }

    const rows = this.parseLclExcel(buffer);

    const pickupDefaults = {
      pickupDate: params.pickupDate,
      pickupAddress1: params.pickupAddress1,
      ...(params.pickupAddress2 && { pickupAddress2: params.pickupAddress2 }),
      ...(params.pickupPostal && { pickupPostal: params.pickupPostal }),
      ...(params.pickupContactName && {
        pickupContactName: params.pickupContactName,
      }),
      ...(params.pickupContactPhone && {
        pickupContactPhone: params.pickupContactPhone,
      }),
    };

    let valid = 0;
    let invalid = 0;

    for (const row of rows) {
      row.errors = this.validateLclRow(row, {
        customerCompanyId: params.customerCompanyId,
        pickupDate: params.pickupDate,
        pickupAddress1: params.pickupAddress1,
        pickupContactPhone: params.pickupContactPhone,
      });

      if (row.errors.length === 0) valid++;
      else invalid++;
    }

    return {
      template: "LCL_ORDER_IN_BATCH",
      customerCompanyId: params.customerCompanyId,
      pickupDefaults,
      rows,
      stats: { total: rows.length, valid, invalid },
    };
  }

  async lclImportConfirm(
    tenantId: string,
    dto: LclImportConfirmRequestDto,
    actorUserId: string | null,
  ): Promise<LclImportConfirmResponseDto> {
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: dto.customerCompanyId, tenantId },
    });

    if (!company) {
      throw new BadRequestException(
        "Customer company not found or does not belong to tenant",
      );
    }

    const failedRows: { rowKey: string; reason: string }[] = [];
    const created: {
      id: string;
      internalRef: string;
      externalRef: string | null;
    }[] = [];
    let createdCount = 0;

    const pickupDate = dto.pickupDate ? new Date(dto.pickupDate) : null;
    if (!pickupDate || Number.isNaN(pickupDate.getTime())) {
      throw new BadRequestException("pickupDate must be a valid date (YYYY-MM-DD)");
    }

    for (const row of dto.rows) {
      const errors = this.validateLclRow(
        {
          rowKey: row.rowKey,
          externalRef: row.externalRef,
          receiverName: row.receiverName,
          receiverPhone: row.receiverPhone,
          deliveryAddress1: row.deliveryAddress1,
          deliveryAddress2: row.deliveryAddress2,
          deliveryPostal: row.deliveryPostal,
          deliveryCity: row.deliveryCity,
          deliveryCountry: row.deliveryCountry,
          itemsSummary: row.itemsSummary,
          specialRequest: row.specialRequest,
          errors: [],
        },
        {
          customerCompanyId: dto.customerCompanyId,
          pickupDate: dto.pickupDate,
          pickupAddress1: dto.pickupAddress1,
          pickupContactPhone: dto.pickupContactPhone,
        },
      );

      if (errors.length > 0) {
        failedRows.push({ rowKey: row.rowKey, reason: errors.join("; ") });
        continue;
      }

      const notesParts: string[] = [];
      if (row.specialRequest) notesParts.push(row.specialRequest);
      if (row.deliveryCity || row.deliveryCountry) {
        notesParts.push(
          [row.deliveryCity, row.deliveryCountry].filter(Boolean).join(", "),
        );
      }

      const notes = notesParts.length > 0 ? notesParts.join(" | ") : null;

      const parsedItems =
        row.itemsSummary
          ?.split(";")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const match = part.match(/^(.*?)\s*x(\d+)$/i);
            if (!match) {
              return {
                itemCode: part,
                qty: 1,
              };
            }
            return {
              itemCode: match[1].trim(),
              qty: Math.max(1, Number(match[2]) || 1),
            };
          }) ?? [];

      try {
        const internalRef = await this.getNextInternalRef(tenantId, JobType.LCL);

        const job = await this.prisma.job.create({
          data: {
            tenantId,
            customerCompanyId: dto.customerCompanyId,
            internalRef,
            externalRef: row.externalRef || null,
            jobType: JobType.LCL,
            status: JobStatus.Draft,
            notes,
            pickupDate,
            pickupAddress1: dto.pickupAddress1,
            pickupAddress2: dto.pickupAddress2 ?? null,
            pickupPostal: dto.pickupPostal ?? null,
            pickupContactName: dto.pickupContactName ?? null,
            pickupContactPhone: dto.pickupContactPhone ?? null,
            deliveryAddress1: row.deliveryAddress1,
            deliveryAddress2: row.deliveryAddress2 ?? null,
            deliveryPostal: row.deliveryPostal ?? null,
            receiverName: row.receiverName,
            receiverPhone: row.receiverPhone,
            items: {
              create:
                parsedItems.length > 0
                  ? parsedItems.map((item) => ({
                      tenantId,
                      itemCode: item.itemCode,
                      description: null,
                      qty: item.qty,
                    }))
                  : [
                      {
                        tenantId,
                        itemCode: "UNSPECIFIED",
                        description: "Imported job item",
                        qty: 1,
                      },
                    ],
            },
          },
        });

        createdCount++;
        created.push({
          id: job.id,
          internalRef: job.internalRef,
          externalRef: job.externalRef,
        });

        await this.audit.log(
          tenantId,
          "CREATE",
          "JOB",
          job.id,
          {
            internalRef: job.internalRef,
            externalRef: job.externalRef,
            source: "LCL_EXCEL_IMPORT",
          },
          actorUserId,
        );
      } catch (e: any) {
        failedRows.push({
          rowKey: row.rowKey,
          reason: e?.message ?? "Create failed",
        });
      }
    }

    return { createdCount, failedRows, created };
  }

  private async buildDoPdfBuffer(job: {
    id: string;
    internalRef: string;
    externalRef?: string | null;
    pickupDate: Date | null;
    deliveryAddress1: string;
    deliveryAddress2: string | null;
    deliveryPostal: string | null;
    receiverName: string;
    receiverPhone: string;
    notes: string | null;
    customerCompany?: { name: string } | null;
    items: Array<{
      itemCode: string;
      description: string | null;
      qty: number;
    }>;
  }): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
  
    // A4 landscape
    const page = pdfDoc.addPage([841.89, 595.28]);
    const { width, height } = page.getSize();
  
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
  
    const black = rgb(0, 0, 0);
    const grayFill = rgb(0.84, 0.84, 0.84);
  
    const internalRef = job.internalRef?.trim() || "-";
    const externalRef = job.externalRef?.trim() || "-";
    const receiverName = job.receiverName?.trim() || "-";
    const receiverPhone = job.receiverPhone?.trim() || "-";
    const specialRequest = job.notes?.trim() || "-";
  
    const deliveryAddress = [
      job.deliveryAddress1,
      job.deliveryAddress2,
      job.deliveryPostal,
    ]
      .map((v) => (v ?? "").trim())
      .filter(Boolean)
      .join(" ");
  
    const pickupDate = this.formatDoDate(job.pickupDate);
  
    const items = job.items?.length
      ? job.items
      : [{ itemCode: "-", description: null, qty: 1 }];
  
    const itemCodeText = items.map((it) => it.itemCode || "-").join("\n");
    const itemQtyText = items.map((it) => String(it.qty ?? 1)).join("\n");
  
    // ===== RIGHT VERTICAL COMPANY BLOCK =====
    const companyBlockX = width - 90;
    const companyBlockTop = height - 40;
  
    try {
      const possiblePaths = [
        path.join(process.cwd(), "dist", "assets", "db-logo.png"),
        path.join(process.cwd(), "src", "assets", "db-logo.png"),
      ];
  
      let logoBytes: Buffer | null = null;
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          logoBytes = fs.readFileSync(p);
          break;
        }
      }
  
      if (logoBytes) {
        const logoImage = await pdfDoc.embedPng(logoBytes);
        const dims = logoImage.scale(0.17);
  
        page.drawImage(logoImage, {
          x: width - 86,
          y: height - 120,
          width: dims.width,
          height: dims.height,
        });
      }
    } catch {
      // ignore logo load failure
    }
  
    this.drawRotatedText(
      page,
      "DB WISDOM SERVICES PTE LTD",
      companyBlockX,
      companyBlockTop,
      15,
      bold,
      black,
    );
  
    this.drawRotatedText(
      page,
      "Office and Warehouse: 71 Gul Circle, Singapore 629585",
      companyBlockX - 22,
      companyBlockTop - 4,
      8.5,
      font,
      black,
    );
  
    this.drawRotatedText(
      page,
      "ROC201243452N / UEN NO 201243452N",
      companyBlockX - 36,
      companyBlockTop - 4,
      7.5,
      font,
      black,
    );
  
    // ===== MAIN BAND TABLE =====
    const leftX = 48;
    const topY = height - 135;
    const tableW = 650;
    const labelH = 26;
  
    const cols = [
      { label: "Internal Ref", width: 92 },
      { label: "External Ref", width: 92 },
      { label: "First / Last Name", width: 110 },
      { label: "Phone", width: 76 },
      { label: "Delivery Address", width: 175 },
      { label: "Item Code", width: 70 },
      { label: "Item Qty", width: 50 },
      { label: "Special Request", width: 85 },
    ] as const;
  
    let cx = leftX;
    for (const col of cols) {
      page.drawRectangle({
        x: cx,
        y: topY - labelH,
        width: col.width,
        height: labelH,
        color: grayFill,
      });
      page.drawRectangle({
        x: cx,
        y: topY - labelH,
        width: col.width,
        height: labelH,
        borderWidth: 0.8,
        borderColor: black,
      });
      this.drawCellLabel(page, col.label, cx + 5, topY - 17, bold, black, 9);
      cx += col.width;
    }
  
    const rowHeight = this.estimateRowHeight(
      [
        internalRef,
        externalRef,
        receiverName,
        receiverPhone,
        deliveryAddress || "-",
        itemCodeText,
        itemQtyText,
        specialRequest,
      ],
      cols.map((c) => c.width - 10),
      font,
      10,
      12,
      58,
    );
  
    const rowTopY = topY - labelH;
  
    cx = leftX;
    for (const col of cols) {
      page.drawRectangle({
        x: cx,
        y: rowTopY - rowHeight,
        width: col.width,
        height: rowHeight,
        borderWidth: 0.8,
        borderColor: black,
      });
      cx += col.width;
    }
  
    cx = leftX;
    this.drawBlockText(page, internalRef, cx + 5, rowTopY - 14, cols[0].width - 10, rowHeight - 8, font, bold, 10, black, 4);
    cx += cols[0].width;
  
    this.drawBlockText(page, externalRef, cx + 5, rowTopY - 14, cols[1].width - 10, rowHeight - 8, font, bold, 10, black, 4);
    cx += cols[1].width;
  
    this.drawBlockText(page, receiverName, cx + 5, rowTopY - 14, cols[2].width - 10, rowHeight - 8, font, bold, 10, black, 4);
    cx += cols[2].width;
  
    this.drawBlockText(page, receiverPhone, cx + 5, rowTopY - 14, cols[3].width - 10, rowHeight - 8, font, bold, 10, black, 4);
    cx += cols[3].width;
  
    this.drawBlockText(page, deliveryAddress || "-", cx + 5, rowTopY - 14, cols[4].width - 10, rowHeight - 8, font, bold, 10, black, 6);
    cx += cols[4].width;
  
    this.drawMultilineText(page, itemCodeText, cx + 5, rowTopY - 14, cols[5].width - 10, font, 10, 12, black, 6);
    cx += cols[5].width;
  
    this.drawMultilineText(page, itemQtyText, cx + 5, rowTopY - 14, cols[6].width - 10, font, 10, 12, black, 6);
    cx += cols[6].width;
  
    this.drawBlockText(page, specialRequest, cx + 5, rowTopY - 14, cols[7].width - 10, rowHeight - 8, font, bold, 10, black, 6);
  
    // ===== PICKUP DATE SMALL STRIP =====
    const pickupY = rowTopY - rowHeight - 22;
    const pickupLabelW = 90;
    const pickupValueW = 110;
  
    page.drawRectangle({
      x: leftX,
      y: pickupY - 24,
      width: pickupLabelW,
      height: 24,
      color: grayFill,
    });
    page.drawRectangle({
      x: leftX,
      y: pickupY - 24,
      width: pickupLabelW,
      height: 24,
      borderWidth: 0.8,
      borderColor: black,
    });
    this.drawCellLabel(page, "Pickup Date", leftX + 6, pickupY - 16, bold, black, 9);
  
    page.drawRectangle({
      x: leftX + pickupLabelW,
      y: pickupY - 24,
      width: pickupValueW,
      height: 24,
      borderWidth: 0.8,
      borderColor: black,
    });
    this.drawCellValue(page, pickupDate, leftX + pickupLabelW + 6, pickupY - 16, font, black, 10);
  
    // ===== DECLARATION =====
    const declarationX = 48;
    const declarationY = pickupY - 82;
  
    page.drawText("Received the above stated goods in good order and condition:", {
      x: declarationX,
      y: declarationY,
      size: 11,
      font: bold,
      color: black,
    });
  
    // ===== SIGNATURE / DATE AREA =====
    const signLineY = declarationY - 74;
  
    page.drawLine({
      start: { x: declarationX, y: signLineY },
      end: { x: declarationX + 250, y: signLineY },
      thickness: 1,
      color: black,
    });
  
    page.drawLine({
      start: { x: declarationX + 330, y: signLineY },
      end: { x: declarationX + 580, y: signLineY },
      thickness: 1,
      color: black,
    });
  
    page.drawText("Signature / Name / NRIC No.", {
      x: declarationX,
      y: signLineY - 18,
      size: 9,
      font,
      color: black,
    });
  
    page.drawText("Date / Time", {
      x: declarationX + 330,
      y: signLineY - 18,
      size: 9,
      font,
      color: black,
    });
  
    // ===== BOTTOM META =====
    page.drawText("Generated from OpsFlow", {
      x: 48,
      y: 18,
      size: 8,
      font,
      color: black,
    });
  
    page.drawText(`Job ID: ${job.id}`, {
      x: 170,
      y: 18,
      size: 8,
      font,
      color: black,
    });
  
    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }

  private wrapPdfText(text: string, maxCharsPerLine: number): string[] {
    if (!text) return ["-"];

    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";

    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= maxCharsPerLine) {
        current = next;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }

    if (current) lines.push(current);

    return lines;
  }

  private safeFileName(value: string): string {
    return value
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private formatDoDate(value?: Date | string | null): string {
    if (!value) return "-";
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("en-SG");
  }
  
  private drawRotatedText(
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    size: number,
    font: PDFFont,
    color: ReturnType<typeof rgb>,
  ) {
    page.drawText(text, {
      x,
      y,
      size,
      font,
      color,
      rotate: degrees(-90),
    });
  }
  
  private drawCellLabel(
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    font: PDFFont,
    color: ReturnType<typeof rgb>,
    size = 9,
  ) {
    page.drawText(text, {
      x,
      y,
      size,
      font,
      color,
    });
  }
  
  private drawCellValue(
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    font: PDFFont,
    color: ReturnType<typeof rgb>,
    size = 10,
  ) {
    page.drawText(text, {
      x,
      y,
      size,
      font,
      color,
    });
  }
  
  private drawBlockText(
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    maxHeight: number,
    normalFont: PDFFont,
    boldFont: PDFFont,
    fontSize: number,
    color: ReturnType<typeof rgb>,
    maxLines = 4,
  ) {
    const lines = this.wrapPdfTextByWidth(text || "-", maxWidth, fontSize, normalFont);
    let yy = y;
    let count = 0;
  
    for (const line of lines) {
      if (count >= maxLines) break;
      if (yy < y - maxHeight) break;
  
      page.drawText(line, {
        x,
        y: yy,
        size: fontSize,
        font: normalFont,
        color,
      });
  
      yy -= 12;
      count++;
    }
  }
  
  private drawMultilineText(
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    font: PDFFont,
    fontSize: number,
    lineHeight: number,
    color: ReturnType<typeof rgb>,
    maxLines = 6,
  ) {
    const rawLines = String(text || "-")
      .split("\n")
      .flatMap((line) =>
        this.wrapPdfTextByWidth(line || "-", maxWidth, fontSize, font),
      );
  
    let yy = y;
    for (const line of rawLines.slice(0, maxLines)) {
      page.drawText(line, {
        x,
        y: yy,
        size: fontSize,
        font,
        color,
      });
      yy -= lineHeight;
    }
  }
  
  private wrapPdfTextByWidth(
    text: string,
    maxWidth: number,
    fontSize: number,
    font: PDFFont,
  ): string[] {
    if (!text?.trim()) return ["-"];
  
    const paragraphs = text.split("\n");
    const output: string[] = [];
  
    for (const paragraph of paragraphs) {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
  
      if (!words.length) {
        output.push("-");
        continue;
      }
  
      let current = "";
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        const width = font.widthOfTextAtSize(candidate, fontSize);
  
        if (width <= maxWidth) {
          current = candidate;
        } else {
          if (current) output.push(current);
          current = word;
        }
      }
  
      if (current) output.push(current);
    }
  
    return output.length ? output : ["-"];
  }
  
  private estimateRowHeight(
    values: string[],
    widths: number[],
    font: PDFFont,
    fontSize: number,
    lineHeight: number,
    minHeight = 42,
  ): number {
    let maxLines = 1;
  
    for (let i = 0; i < values.length; i++) {
      const lineCount = this.wrapPdfTextByWidth(
        values[i] || "-",
        widths[i],
        fontSize,
        font,
      ).length;
      maxLines = Math.max(maxLines, lineCount);
    }
  
    return Math.max(minHeight, maxLines * lineHeight + 10);
  }
}
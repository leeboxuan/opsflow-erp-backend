import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { JobStatus, JobType, JobDocumentType, Role } from "@prisma/client";
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
import { JobDto, JobDocumentDto, JobTrackingDto, AuditLogEntryDto } from "./dto/job.dto";
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

function toJobDto(j: any): JobDto {
  const assignedDriverName =
    j.assignedDriver
      ? [j.assignedDriver.firstName, j.assignedDriver.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() || j.assignedDriver.email || null
      : null;

  const assignedVehicleName =
    j.assignedVehicle
      ? [j.assignedVehicle.plateNo, j.assignedVehicle.vehicleDescription]
          .filter(Boolean)
          .join(" • ")
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
    assignedVehicleName,

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

    documents: j.documents?.map((d: any) => toDocDto(d)),
  };
}

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

@Injectable()
export class OpsJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly supabaseService: SupabaseService,
  ) {}

  private async getNextInternalRef(tenantId: string): Promise<string> {
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
    return `JOB-${yyyy}${MM}-${seq}`;
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
        where.pickupDate.gte = new Date(query.pickupDateFrom + "T00:00:00.000Z");
      }
      if (query.pickupDateTo) {
        where.pickupDate.lte = new Date(query.pickupDateTo + "T23:59:59.999Z");
      }
    }

    const q = (query.q ?? query.search)?.trim();
    applyQSearch(where, q, [
      "internalRef",
      "pickupAddress1",
      "deliveryAddress1",
      "receiverName",
      "receiverPhone",
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
      ["createdAt", "updatedAt", "pickupDate", "internalRef", "status"],
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
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          assignedVehicle: {
            select: { id: true, plateNo: true, vehicleDescription: true },
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

    const internalRef = await this.getNextInternalRef(tenantId);

    const job = await this.prisma.job.create({
      data: {
        tenantId,
        customerCompanyId: dto.customerCompanyId,
        internalRef,
        jobType: dto.jobType,
        status: JobStatus.Draft,
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
      },
    });

    await this.audit.log(
      tenantId,
      "CREATE",
      "JOB",
      job.id,
      { internalRef: job.internalRef },
      actorUserId,
    );

    return toJobDto(job);
  }

  async getOne(tenantId: string, jobId: string): Promise<JobDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      include: {
        customerCompany: {
          select: { id: true, name: true },
        },
        assignedDriver: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        assignedVehicle: {
          select: { id: true, plateNo: true, vehicleDescription: true },
        },
      },
    });
    if (!job) throw new NotFoundException("Job not found");
    return toJobDto(job);
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
    if (job.status === JobStatus.Completed || job.status === JobStatus.Cancelled) {
      throw new BadRequestException("Cannot edit job in Completed or Cancelled status");
    }

    const data: any = {};
    if (dto.jobType !== undefined) data.jobType = dto.jobType;
    if (dto.customerCompanyId !== undefined) data.customerCompanyId = dto.customerCompanyId;
    if (dto.pickupDate !== undefined) data.pickupDate = dto.pickupDate ? new Date(dto.pickupDate) : null;
    if (dto.pickupAddress1 !== undefined) data.pickupAddress1 = dto.pickupAddress1;
    if (dto.pickupAddress2 !== undefined) data.pickupAddress2 = dto.pickupAddress2;
    if (dto.pickupPostal !== undefined) data.pickupPostal = dto.pickupPostal;
    if (dto.pickupContactName !== undefined) data.pickupContactName = dto.pickupContactName;
    if (dto.pickupContactPhone !== undefined) data.pickupContactPhone = dto.pickupContactPhone;
    if (dto.deliveryAddress1 !== undefined) data.deliveryAddress1 = dto.deliveryAddress1;
    if (dto.deliveryAddress2 !== undefined) data.deliveryAddress2 = dto.deliveryAddress2;
    if (dto.deliveryPostal !== undefined) data.deliveryPostal = dto.deliveryPostal;
    if (dto.receiverName !== undefined) data.receiverName = dto.receiverName;
    if (dto.receiverPhone !== undefined) data.receiverPhone = dto.receiverPhone;

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data,
    });

    await this.audit.log(
      tenantId,
      "UPDATE",
      "JOB",
      jobId,
      { changedFields: Object.keys(data) },
      actorUserId,
    );

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
      throw new BadRequestException("Driver not found or not a DRIVER in this tenant");
    }

    let vehicleId: string | null = dto.vehicleId ?? null;
    if (!vehicleId) {
      const driver = await this.prisma.drivers.findFirst({
        where: { tenantId, userId: dto.driverId },
        include: { defaultVehicle: true },
      });
      if (!driver?.defaultVehicleId) {
        throw new BadRequestException("Driver has no default vehicle; provide vehicleId");
      }
      vehicleId = driver.defaultVehicleId;
    } else {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: vehicleId, tenantId },
      });
      if (!vehicle) throw new BadRequestException("Vehicle not found");
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        assignedDriverId: dto.driverId,
        assignedVehicleId: vehicleId,
        assignedAt: new Date(),
        status: JobStatus.Assigned,
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
      (job.status === JobStatus.Assigned && !job.startedAt && !job.assignedDriverId);

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
      throw new BadRequestException("Verify depot only applies to IMPORT/EXPORT jobs");
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
      QUOTATION_MIMES.some((m) => mime === m) ||
      QUOTATION_EXT.test(name);
    if (!allowedMime) {
      throw new BadRequestException(
        "Quotation must be PDF, XLSX, or XLS. Got: " + (mime || file.originalname || "unknown"),
      );
    }

    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".pdf";
    const key = `${tenantId}/jobs/${jobId}/quotation/${Date.now()}${ext}`;

    const supabase = this.supabaseService.getClient();
    const { error } = await supabase.storage
      .from(JOB_DOCUMENTS_BUCKET)
      .upload(key, file.buffer, { contentType: file.mimetype ?? "application/octet-stream", upsert: true });

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
      "UPLOAD_DOC",
      "JOB",
      jobId,
      { documentId: doc.id, type: "QUOTATION" },
      actorUserId,
    );

    return this.attachSignedUrl(doc);  }

    async listDocuments(tenantId: string, jobId: string): Promise<JobDocumentDto[]> {
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
   * Column order: 0=companyCode/companyId, 1=jobType, 2=pickupAddress, 3=deliveryAddress,
   * 4=receiverName, 5=receiverPhone, 6=pickupDate, 7=driverEmail (optional).
   * If first row looks like headers (contains "company", "job type", etc.), it is skipped.
   */
  private parseExcelToRows(buffer: Buffer): { rowNumber: number; data: ImportJobRowDto }[] {
    let XLSX: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      XLSX = require("xlsx");
    } catch {
      throw new BadRequestException("Excel import requires xlsx package (npm install xlsx)");
    }

    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return [];

    const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (rawRows.length < 1) return [];

    const first = rawRows[0] as any[];
    const isHeaderRow =
      first?.some(
        (c) =>
          typeof c === "string" &&
          /company|job\s*type|pickup|delivery|receiver|date|driver/i.test(String(c)),
      ) ?? false;

    const start = isHeaderRow ? 1 : 0;
    const out: { rowNumber: number; data: ImportJobRowDto }[] = [];

    const get = (row: any[], idx: number): string => {
      const v = row[idx];
      return v != null ? String(v).trim() : "";
    };

    for (let i = start; i < rawRows.length; i++) {
      const row = rawRows[i] as any[];
      if (!row || row.every((c) => c == null || String(c).trim() === "")) continue;

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

  /**
   * Validate a single row and resolve company + optional driver. Returns errors and resolved ids.
   */
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
    if (!row.pickupDate?.trim()) errors.push("pickupDate is required");
    else {
      const d = new Date(row.pickupDate);
      if (Number.isNaN(d.getTime())) errors.push("pickupDate must be a valid date (YYYY-MM-DD)");
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

  /**
   * Preview: parse Excel, validate rows, return parsed data + errors. No DB writes.
   */
  async importPreview(
    tenantId: string,
    buffer: Buffer,
  ): Promise<{ rows: ImportPreviewRowDto[] }> {
    const parsed = this.parseExcelToRows(buffer);
    const rows: ImportPreviewRowDto[] = [];

    for (const { rowNumber, data } of parsed) {
      const { errors, customerCompanyId, driverId } = await this.validateAndResolveRow(
        tenantId,
        data,
      );
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

  /**
   * Confirm: validate rows again, create Draft jobs, return summary.
   */
  async importConfirm(
    tenantId: string,
    requestRows: ImportConfirmRowDto[],
    actorUserId: string | null,
  ): Promise<{ createdCount: number; failedRows: { rowNumber: number; reason: string }[] }> {
    const failedRows: { rowNumber: number; reason: string }[] = [];
    let createdCount = 0;

    for (let i = 0; i < requestRows.length; i++) {
      const row = requestRows[i];
      const rowNum = row.rowNumber ?? i + 1;

      const { errors, customerCompanyId, driverId } = await this.validateAndResolveRow(
        tenantId,
        row as ImportJobRowDto,
      );

      if (errors.length > 0) {
        failedRows.push({ rowNumber: rowNum, reason: errors.join("; ") });
        continue;
      }
      if (!customerCompanyId) {
        failedRows.push({ rowNumber: rowNum, reason: "Company could not be resolved" });
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

        const internalRef = await this.getNextInternalRef(tenantId);
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
          },
        });
        createdCount++;
        await this.audit.log(
          tenantId,
          "CREATE",
          "JOB",
          job.id,
          { internalRef: job.internalRef, source: "import_confirm", row: rowNum },
          actorUserId,
        );
      } catch (e: any) {
        failedRows.push({ rowNumber: rowNum, reason: e?.message ?? "Create failed" });
      }
    }

    return { createdCount, failedRows };
  }

  // --- LCL Order In template import (preview → confirm) ---

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
    const s = String(v).replace(/\s+/g, " ").trim();
    return s;
  }

  private static cell(row: any[], idx: number): string {
    const v = row[idx];
    if (v == null) return "";
    return String(v).replace(/\s+/g, " ").trim();
  }

  /**
   * Parse LCL Order In template: first sheet, header row, group by Order Ref.
   * Returns one entry per unique Order Ref with aggregated items and special request.
   */
  private parseLclExcel(buffer: Buffer): LclImportPreviewRowDto[] {
    let XLSX: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      XLSX = require("xlsx");
    } catch {
      throw new BadRequestException("Excel import requires xlsx package (npm install xlsx)");
    }

    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];
    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet) return [];

    const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
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
      if (!row || row.every((c) => c == null || String(c).trim() === "")) continue;

      const orderRef = OpsJobsService.cell(row, idx.orderRef);
      if (!orderRef) continue;

      const deliveryAddress1 = OpsJobsService.cell(row, idx.deliveryAddress1);
      const deliveryAddress2 = idx.deliveryAddress2 >= 0 ? OpsJobsService.cell(row, idx.deliveryAddress2) : "";
      const deliveryCity = idx.deliveryCity >= 0 ? OpsJobsService.cell(row, idx.deliveryCity) : "";
      const deliveryPostalCode = idx.deliveryPostalCode >= 0 ? OpsJobsService.cell(row, idx.deliveryPostalCode) : "";
      const deliveryCountry = idx.deliveryCountry >= 0 ? OpsJobsService.cell(row, idx.deliveryCountry) : "";
      const deliveryFirstName = idx.deliveryFirstName >= 0 ? OpsJobsService.cell(row, idx.deliveryFirstName) : "";
      const deliveryLastName = idx.deliveryLastName >= 0 ? OpsJobsService.cell(row, idx.deliveryLastName) : "";
      const firstName = idx.firstName >= 0 ? OpsJobsService.cell(row, idx.firstName) : "";
      const lastName = idx.lastName >= 0 ? OpsJobsService.cell(row, idx.lastName) : "";
      const phone = idx.phone >= 0 ? OpsJobsService.normalizePhone(row[idx.phone]) : "";
      const mobile = idx.mobile >= 0 ? OpsJobsService.normalizePhone(row[idx.mobile]) : "";
      const itemCode = idx.itemCode >= 0 ? OpsJobsService.cell(row, idx.itemCode) : "";
      const itemQty = idx.itemQty >= 0 ? OpsJobsService.cell(row, idx.itemQty) : "";
      const specialRequest = idx.specialRequest >= 0 ? OpsJobsService.cell(row, idx.specialRequest) : "";

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
      if (deliveryPostalCode && !g.deliveryPostalCode) g.deliveryPostalCode = deliveryPostalCode;
      if (deliveryCountry && !g.deliveryCountry) g.deliveryCountry = deliveryCountry;
      if (deliveryFirstName && !g.deliveryFirstName) g.deliveryFirstName = deliveryFirstName;
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
        g.specialRequests.size > 0 ? [...g.specialRequests].filter(Boolean).join(" | ") : undefined;

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

  /**
   * Validate one LCL preview row (and optionally fill errors). Uses request-level pickup defaults.
   */
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
    const receiverPhone = (row.receiverPhone || "").trim() || (pickup.pickupContactPhone || "").trim();
    if (!receiverPhone) errors.push("receiverPhone is required (or set pickupContactPhone as default)");
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
      throw new BadRequestException("Customer company not found or does not belong to tenant");
    }

    const rows = this.parseLclExcel(buffer);
    const pickupDefaults = {
      pickupDate: params.pickupDate,
      pickupAddress1: params.pickupAddress1,
      ...(params.pickupAddress2 && { pickupAddress2: params.pickupAddress2 }),
      ...(params.pickupPostal && { pickupPostal: params.pickupPostal }),
      ...(params.pickupContactName && { pickupContactName: params.pickupContactName }),
      ...(params.pickupContactPhone && { pickupContactPhone: params.pickupContactPhone }),
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
      throw new BadRequestException("Customer company not found or does not belong to tenant");
    }

    const failedRows: { rowKey: string; reason: string }[] = [];
    const created: { id: string; internalRef: string; externalRef: string | null }[] = [];
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
      if (row.itemsSummary) notesParts.push(row.itemsSummary);
      if (row.specialRequest) notesParts.push(row.specialRequest);
      if (row.deliveryCity || row.deliveryCountry) {
        notesParts.push([row.deliveryCity, row.deliveryCountry].filter(Boolean).join(", "));
      }
      const notes = notesParts.length > 0 ? notesParts.join(" | ") : null;

      try {
        const internalRef = await this.getNextInternalRef(tenantId);
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
          { internalRef: job.internalRef, externalRef: job.externalRef, source: "LCL_EXCEL_IMPORT" },
          actorUserId,
        );
      } catch (e: any) {
        failedRows.push({ rowKey: row.rowKey, reason: e?.message ?? "Create failed" });
      }
    }

    return { createdCount, failedRows, created };
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
}

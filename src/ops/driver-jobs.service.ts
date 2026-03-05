import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { JobStatus, JobType, JobDocumentType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { parsePaginationFromQuery, buildPaginationMeta } from "../common/pagination";
import { AuditService } from "../audit/audit.service";
import { SupabaseService } from "../auth/supabase.service";
import { DriverCompleteJobDto } from "./dto/complete-job.dto";
import { JobLocationDto } from "./dto/location.dto";
import { JobDto, JobDocumentDto } from "./dto/job.dto";

const JOB_DOCUMENTS_BUCKET = "job-documents";

function toJobDto(j: any): JobDto {
  return {
    id: j.id,
    tenantId: j.tenantId,
    customerCompanyId: j.customerCompanyId,
    internalRef: j.internalRef,
    jobType: j.jobType,
    status: j.status,
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
    assignedVehicleId: j.assignedVehicleId,
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
  };
}

function toDocDto(d: any): JobDocumentDto {
  return {
    id: d.id,
    type: d.type,
    originalName: d.originalName,
    mimeType: d.mimeType,
    createdAt: d.createdAt,
  };
}

@Injectable()
export class DriverJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async listByDriver(
    tenantId: string,
    driverUserId: string,
    dateStr: string,
    query?: { page?: unknown; pageSize?: unknown },
  ): Promise<{ data: JobDto[]; meta: { page: number; pageSize: number; total: number } }> {
    const date = new Date(dateStr + "T00:00:00.000Z");
    const nextDay = new Date(date);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    const { page, pageSize, skip, take } = parsePaginationFromQuery(query ?? {});

    const where = {
      tenantId,
      assignedDriverId: driverUserId,
      status: {
        in: [JobStatus.Assigned, JobStatus.InProgress, JobStatus.PendingDepot, JobStatus.Completed],
      },
      pickupDate: {
        gte: date,
        lt: nextDay,
      },
    };

    const [total, jobs] = await this.prisma.$transaction([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        orderBy: [{ pickupDate: "asc" }, { createdAt: "asc" }],
        skip,
        take,
      }),
    ]);

    return {
      data: jobs.map(toJobDto),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async getOneForDriver(
    tenantId: string,
    jobId: string,
    driverUserId: string,
  ): Promise<JobDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId, assignedDriverId: driverUserId },
    });
    if (!job) throw new NotFoundException("Job not found or not assigned to you");
    return toJobDto(job);
  }

  async start(
    tenantId: string,
    jobId: string,
    driverUserId: string,
  ): Promise<JobDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId, assignedDriverId: driverUserId },
    });
    if (!job) throw new NotFoundException("Job not found or not assigned to you");
    if (job.status !== JobStatus.Assigned) {
      throw new BadRequestException("Job must be Assigned to start");
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.InProgress, startedAt: new Date() },
    });

    await this.audit.log(
      tenantId,
      "DRIVER_START",
      "JOB",
      jobId,
      {},
      driverUserId,
    );

    return toJobDto(updated);
  }

  async updateLocation(
    tenantId: string,
    jobId: string,
    driverUserId: string,
    dto: JobLocationDto,
  ): Promise<void> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId, assignedDriverId: driverUserId },
    });
    if (!job) throw new NotFoundException("Job not found or not assigned to you");

    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        lastLat: dto.lat,
        lastLng: dto.lng,
        lastLocationAt: new Date(),
      },
    });
  }

  private async uploadDocument(
    tenantId: string,
    jobId: string,
    driverUserId: string,
    file: Express.Multer.File,
    type: JobDocumentType,
    allowedMimes: string[],
  ): Promise<JobDocumentDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId, assignedDriverId: driverUserId },
    });
    if (!job) throw new NotFoundException("Job not found or not assigned to you");

    const mime = String(file.mimetype ?? "").toLowerCase();
    if (!allowedMimes.some((m) => mime.startsWith(m))) {
      throw new BadRequestException(`Invalid file type. Allowed: ${allowedMimes.join(", ")}`);
    }

    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg";
    const folder = type === JobDocumentType.POD_PHOTO ? "pod-photos" : "signatures";
    const key = `${tenantId}/jobs/${jobId}/${folder}/${Date.now()}${ext}`;

    const supabase = this.supabaseService.getClient();
    const { error } = await supabase.storage
      .from(JOB_DOCUMENTS_BUCKET)
      .upload(key, file.buffer, {
        contentType: file.mimetype ?? "image/jpeg",
        upsert: true,
      });

    if (error) {
      throw new BadRequestException(`Storage upload failed: ${error.message}`);
    }

    const doc = await this.prisma.jobDocument.create({
      data: {
        tenantId,
        jobId,
        type,
        storageKey: key,
        originalName: file.originalname ?? "upload",
        mimeType: file.mimetype ?? "image/jpeg",
        sizeBytes: file.size ?? null,
        uploadedByUserId: driverUserId,
      },
    });

    await this.audit.log(
      tenantId,
      "UPLOAD_DOC",
      "JOB",
      jobId,
      { documentId: doc.id, type },
      driverUserId,
    );

    return toDocDto(doc);
  }

  async uploadPodPhotos(
    tenantId: string,
    jobId: string,
    driverUserId: string,
    files: Express.Multer.File[],
  ): Promise<JobDocumentDto[]> {
    if (!files?.length) throw new BadRequestException("At least one file required");
    const results: JobDocumentDto[] = [];
    for (const file of files) {
      const doc = await this.uploadDocument(
        tenantId,
        jobId,
        driverUserId,
        file,
        JobDocumentType.POD_PHOTO,
        ["image/"],
      );
      results.push(doc);
    }
    return results;
  }

  async uploadPodSignature(
    tenantId: string,
    jobId: string,
    driverUserId: string,
    file: Express.Multer.File,
  ): Promise<JobDocumentDto> {
    return this.uploadDocument(
      tenantId,
      jobId,
      driverUserId,
      file,
      JobDocumentType.SIGNATURE,
      ["image/"],
    );
  }

  async complete(
    tenantId: string,
    jobId: string,
    driverUserId: string,
    dto: DriverCompleteJobDto,
  ): Promise<JobDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId, assignedDriverId: driverUserId },
      include: { documents: true },
    });
    if (!job) throw new NotFoundException("Job not found or not assigned to you");
    if (job.status !== JobStatus.InProgress) {
      throw new BadRequestException("Job must be InProgress to complete");
    }

    const hasPodPhoto = job.documents.some((d) => d.type === JobDocumentType.POD_PHOTO);
    const hasSignature = job.documents.some((d) => d.type === JobDocumentType.SIGNATURE);
    if (!hasSignature) {
      throw new BadRequestException("At least one SIGNATURE document is required to complete");
    }
    if (!hasPodPhoto) {
      throw new BadRequestException("At least one POD_PHOTO is required to complete");
    }

    const now = new Date();
    let newStatus: JobStatus;
    let completedAt: Date | null = null;

    if (job.jobType === JobType.LCL) {
      newStatus = JobStatus.Completed;
      completedAt = now;
    } else {
      newStatus = JobStatus.PendingDepot;
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: newStatus,
        deliveredAt: now,
        podRecipientName: dto.recipientName,
        ...(completedAt && { completedAt }),
      },
    });

    await this.audit.log(
      tenantId,
      "DRIVER_COMPLETE",
      "JOB",
      jobId,
      { status: newStatus, recipientName: dto.recipientName },
      driverUserId,
    );

    return toJobDto(updated);
  }
}

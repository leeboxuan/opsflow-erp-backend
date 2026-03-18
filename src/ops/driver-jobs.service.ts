import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { JobStatus, JobType, JobDocumentType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { parsePaginationFromQuery, buildPaginationMeta } from "../common/pagination";
import { buildOrderBy } from "../common/listing/listing.sort";
import { AuditService } from "../audit/audit.service";
import { SupabaseService } from "../auth/supabase.service";
import { JobLocationDto } from "./dto/location.dto";
import { JobDto, JobDocumentDto } from "./dto/job.dto";

const JOB_DOCUMENTS_BUCKET = "job-documents";

function normalizeText(value?: string | null): string | null {
  if (!value) return null;
  return value.replace(/\s+/g, " ").trim();
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

function toJobDto(j: any): JobDto {
  const documents = Array.isArray(j.documents) ? j.documents : [];
  const items = Array.isArray(j.items) ? j.items : [];

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

    pickupDate: j.pickupDate ?? null,
    pickupAddress1: j.pickupAddress1,
    pickupAddress2: j.pickupAddress2 ?? null,
    pickupPostal: j.pickupPostal ?? null,
    pickupContactName: normalizeText(j.pickupContactName),
    pickupContactPhone: j.pickupContactPhone ?? null,

    deliveryAddress1: j.deliveryAddress1,
    deliveryAddress2: j.deliveryAddress2 ?? null,
    deliveryPostal: j.deliveryPostal ?? null,
    receiverName: normalizeText(j.receiverName) ?? "",
    receiverPhone: j.receiverPhone,

    assignedDriverId: j.assignedDriverId ?? null,
    assignedDriverName: j.assignedDriver?.name ?? null,
    assignedVehicleId: j.assignedVehicleId ?? null,
    assignedVehiclePlateNo: (j as any).assignedVehiclePlateNo ?? null,

    assignedAt: j.assignedAt ?? null,
    startedAt: j.startedAt ?? null,
    completedAt: j.completedAt ?? null,
    deliveredAt: j.deliveredAt ?? null,
    podRecipientName: normalizeText(j.podRecipientName),

    cancelledReason: j.cancelledReason ?? null,
    cancelledAt: j.cancelledAt ?? null,
    cancelledByUserId: j.cancelledByUserId ?? null,

    lastLat: j.lastLat ?? null,
    lastLng: j.lastLng ?? null,
    lastLocationAt: j.lastLocationAt ?? null,

    createdAt: j.createdAt,
    updatedAt: j.updatedAt,

    items: items.map((item: any) => ({
      id: item.id,
      tenantId: item.tenantId,
      jobId: item.jobId,
      itemCode: item.itemCode,
      description: item.description ?? null,
      qty: item.qty,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),

    documents: documents.map((d: any) => toDocDto(d)),
  };
}

@Injectable()
export class DriverJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly supabaseService: SupabaseService,
  ) {}

  private parseMonthToRange(month: string): { gte: Date; lt: Date } {
    const m = month.trim().match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new BadRequestException("month must be YYYY-MM");

    const year = Number(m[1]);
    const monthNum = Number(m[2]);
    if (!monthNum || monthNum < 1 || monthNum > 12) {
      throw new BadRequestException("month must be YYYY-MM");
    }

    const start = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, monthNum, 1, 0, 0, 0, 0));
    return { gte: start, lt: end };
  }

  private parseDateToRange(dateStr: string): { gte: Date; lt: Date } {
    const date = new Date(dateStr.trim() + "T00:00:00.000Z");
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException("date must be YYYY-MM-DD");
    }

    const nextDay = new Date(date);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return { gte: date, lt: nextDay };
  }

  private parseYearToRange(year: number): { gte: Date; lt: Date } {
    const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
    return { gte: start, lt: end };
  }

  private async attachSignedUrl(doc: any): Promise<JobDocumentDto> {
    const base = toDocDto(doc);

    const supabase = this.supabaseService.getClient();
    const { data } = await supabase.storage
      .from(JOB_DOCUMENTS_BUCKET)
      .createSignedUrl(doc.storageKey, 60 * 60);

    return {
      ...base,
      url: data?.signedUrl ?? null,
    };
  }

  private async findAssignedJobOrThrow(
    tenantId: string,
    jobId: string,
    driverUserId: string,
    include?: Record<string, any>,
  ) {
    const job = await this.prisma.job.findFirst({
      where: {
        id: jobId,
        tenantId,
        assignedDriverId: driverUserId,
      },
      include,
    });

    if (!job) {
      throw new NotFoundException("Job not found or not assigned to you");
    }

    return job;
  }

  async listActiveByDriver(
    tenantId: string,
    driverUserId: string,
    query?: {
      month?: string;
      date?: string;
      sortBy?: string;
      sortDir?: string;
      page?: unknown;
      pageSize?: unknown;
    },
  ): Promise<{ data: JobDto[]; meta: { page: number; pageSize: number; total: number } }> {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query ?? {});

    const statusFilter = {
      in: [
        JobStatus.Assigned,
        JobStatus.InProgress,
        JobStatus.PendingDepot,
      ],
    };

    const where: any = {
      tenantId,
      assignedDriverId: driverUserId,
      status: statusFilter,
    };

    // Filtering rules:
    // - month: pickupDate within that month
    // - date: pickupDate within that day
    // - none: all jobs for the driver
    const month = query?.month?.trim();
    const dateStr = query?.date?.trim();

    if (month) {
      where.pickupDate = this.parseMonthToRange(month);
    } else if (dateStr) {
      where.pickupDate = this.parseDateToRange(dateStr);
    } else {
      // Keep sorting stable (avoid NULL pickupDate entries)
      where.pickupDate = { not: null };
    }

    const orderBy = buildOrderBy(
      query?.sortBy,
      query?.sortDir,
      ["pickupDate", "createdAt", "internalRef", "status"],
      { pickupDate: "asc" },
    );

    const tieBreaker =
      query?.sortBy === "createdAt"
        ? { pickupDate: "asc" as const }
        : { createdAt: "asc" as const };

    const orderByFinal = [orderBy as any, tieBreaker];

    const [total, jobs] = await this.prisma.$transaction([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        orderBy: orderByFinal as any,
        skip,
        take,
        include: {
          customerCompany: {
            select: { id: true, name: true },
          },
          assignedDriver: {
            select: { id: true, name: true },
          },
          items: {
            orderBy: { createdAt: "asc" },
          },
          documents: {
            where: {
              type: {
                in: [JobDocumentType.POD_PHOTO, JobDocumentType.SIGNATURE],
              },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      }),
    ]);

    const vehicleIds = [...new Set(jobs.map((j) => j.assignedVehicleId).filter(Boolean))] as string[];

    const vehicles = vehicleIds.length
      ? await this.prisma.vehicle.findMany({
          where: {
            tenantId,
            id: { in: vehicleIds },
          },
          select: {
            id: true,
            plateNo: true,
          },
        })
      : [];

    const vehicleMap = new Map(vehicles.map((v) => [v.id, v.plateNo]));

    const data = jobs.map((job: any) => {
      const dto = toJobDto({
        ...job,
        assignedVehiclePlateNo: job.assignedVehicleId
          ? vehicleMap.get(job.assignedVehicleId) ?? null
          : null,
      });

      return {
        ...dto,
        documents: dto.documents ?? [],
      };
    });

    return {
      data,
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async listHistoryByDriver(
    tenantId: string,
    driverUserId: string,
    query?: {
      year?: string;
      month?: string;
      sortBy?: string;
      sortDir?: string;
      page?: unknown;
      pageSize?: unknown;
    },
  ): Promise<{
    data: JobDto[];
    meta: { page: number; pageSize: number; total: number };
  }> {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query ?? {});

    const month = query?.month?.trim();
    const yearStr = query?.year?.trim();

    const now = new Date();
    const defaultYear = now.getUTCFullYear();

    let range: { gte: Date; lt: Date };
    if (month) {
      range = this.parseMonthToRange(month);
    } else {
      const year = yearStr ? Number(yearStr) : defaultYear;
      if (!year || Number.isNaN(year)) {
        throw new BadRequestException("year must be YYYY");
      }
      range = this.parseYearToRange(year);
    }

    const where: any = {
      tenantId,
      assignedDriverId: driverUserId,
      status: { in: [JobStatus.Completed, JobStatus.Cancelled] },
      // Practical stable rule: filter history by pickupDate range.
      pickupDate: range,
    };

    const defaultOrder = [
      { completedAt: "desc" as const },
      { updatedAt: "desc" as const },
      { createdAt: "desc" as const },
    ];

    const sortBy = query?.sortBy;
    const sortDir = query?.sortDir ?? "desc";

    const orderByFinal = sortBy
      ? [
          buildOrderBy(
            sortBy,
            sortDir,
            [
              "pickupDate",
              "completedAt",
              "cancelledAt",
              "updatedAt",
              "createdAt",
              "internalRef",
              "status",
            ],
            { completedAt: "desc" },
          ) as any,
          ...defaultOrder,
        ]
      : defaultOrder;

    const [total, jobs] = await this.prisma.$transaction([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        orderBy: orderByFinal as any,
        skip,
        take,
        include: {
          customerCompany: { select: { id: true, name: true } },
          assignedDriver: { select: { id: true, name: true } },
          items: { orderBy: { createdAt: "asc" } },
          documents: {
            where: {
              type: { in: [JobDocumentType.POD_PHOTO, JobDocumentType.SIGNATURE] },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      }),
    ]);

    const vehicleIds = [
      ...new Set(jobs.map((j) => j.assignedVehicleId).filter(Boolean)),
    ] as string[];

    const vehicles = vehicleIds.length
      ? await this.prisma.vehicle.findMany({
          where: { tenantId, id: { in: vehicleIds } },
          select: { id: true, plateNo: true },
        })
      : [];

    const vehicleMap = new Map(vehicles.map((v) => [v.id, v.plateNo]));

    const data = jobs.map((job: any) => {
      const dto = toJobDto({
        ...job,
        assignedVehiclePlateNo: job.assignedVehicleId
          ? vehicleMap.get(job.assignedVehicleId) ?? null
          : null,
      });

      return { ...dto, documents: dto.documents ?? [] };
    });

    return {
      data,
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async getHistorySummaryByDriver(
    tenantId: string,
    driverUserId: string,
  ): Promise<{
    years: {
      year: number;
      total: number;
      months: { month: string; label: string; total: number }[];
    }[];
  }> {
    const rows = await this.prisma.$queryRaw<
      Array<{ year: number; month: string; monthNum: number; total: number }>
    >`
      SELECT
        date_part('year', "pickupDate")::int AS "year",
        to_char("pickupDate", 'YYYY-MM') AS "month",
        date_part('month', "pickupDate")::int AS "monthNum",
        COUNT(*)::int AS "total"
      FROM jobs
      WHERE
        "tenantId" = ${tenantId}
        AND "assignedDriverId" = ${driverUserId}
        AND "status" IN ('Completed', 'Cancelled')
        AND "pickupDate" IS NOT NULL
      GROUP BY 1, 2, 3
      ORDER BY 1 DESC, 3 DESC
    `;

    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    const byYear = new Map<
      number,
      {
        year: number;
        total: number;
        months: { month: string; label: string; total: number; monthNum: number }[];
      }
    >();

    for (const r of rows ?? []) {
      const entry =
        byYear.get(r.year) ??
        ({
          year: r.year,
          total: 0,
          months: [],
        } as any);

      entry.total += r.total;
      entry.months.push({
        month: r.month,
        label: monthNames[r.monthNum - 1] ?? r.month,
        total: r.total,
        monthNum: r.monthNum,
      });
      byYear.set(r.year, entry);
    }

    const years = Array.from(byYear.values()).map((y) => {
      y.months.sort((a, b) => b.monthNum - a.monthNum);
      return {
        year: y.year,
        total: y.total,
        months: y.months.map((m) => ({ month: m.month, label: m.label, total: m.total })),
      };
    });

    years.sort((a, b) => b.year - a.year);
    return { years };
  }

  async getOneForDriver(
    tenantId: string,
    jobId: string,
    driverUserId: string,
  ): Promise<JobDto> {
    const job = await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId, {
      customerCompany: {
        select: {
          id: true,
          name: true,
        },
      },
      assignedDriver: {
        select: {
          id: true,
          name: true,
        },
      },
      items: {
        orderBy: {
          createdAt: "asc",
        },
      },
      documents: {
        orderBy: {
          createdAt: "desc",
        },
      },
    });

    let assignedVehiclePlateNo: string | null = null;

    if (job.assignedVehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: {
          id: job.assignedVehicleId,
          tenantId,
        },
        select: {
          plateNo: true,
        },
      });

      assignedVehiclePlateNo = vehicle?.plateNo ?? null;
    }

    const dto = toJobDto({
      ...job,
      assignedVehiclePlateNo,
    });

    dto.documents = await Promise.all(
      (job.documents ?? []).map((doc: any) => this.attachSignedUrl(doc)),
    );

    return dto;
  }

  async start(
    tenantId: string,
    jobId: string,
    driverUserId: string,
  ): Promise<JobDto> {
    const job = await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId);

    if (job.status !== JobStatus.Assigned) {
      throw new BadRequestException("Job must be Assigned to start");
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.InProgress,
        startedAt: new Date(),
      },
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
    await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId);

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
    await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId);

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

    if (type === JobDocumentType.SIGNATURE) {
      const existingSignature = await this.prisma.jobDocument.findFirst({
        where: {
          tenantId,
          jobId,
          type: JobDocumentType.SIGNATURE,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      if (existingSignature) {
        const updated = await this.prisma.jobDocument.update({
          where: { id: existingSignature.id },
          data: {
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
          { documentId: updated.id, type },
          driverUserId,
        );

        return this.attachSignedUrl(updated);
      }
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

    return this.attachSignedUrl(doc);
  }

  async uploadPodPhotos(
    tenantId: string,
    jobId: string,
    driverUserId: string,
    files: Express.Multer.File[],
  ): Promise<JobDocumentDto[]> {
    if (!files?.length) {
      throw new BadRequestException("At least one file required");
    }

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
  ): Promise<JobDto> {
    const job = await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId, {
      documents: true,
    });

    if (job.status !== JobStatus.InProgress) {
      throw new BadRequestException("Job must be InProgress to complete");
    }

    const hasPodPhoto = job.documents.some((d: any) => d.type === JobDocumentType.POD_PHOTO);
    const hasSignature = job.documents.some((d: any) => d.type === JobDocumentType.SIGNATURE);

    if (!hasSignature) {
      throw new BadRequestException("A signature is required to complete this job");
    }

    if (!hasPodPhoto) {
      throw new BadRequestException("At least one POD photo is required to complete this job");
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
        deliveredAt: job.deliveredAt ?? now,
        completedAt,
      },
    });

    await this.audit.log(
      tenantId,
      "DRIVER_COMPLETE",
      "JOB",
      jobId,
      {
        previousStatus: job.status,
        nextStatus: newStatus,
      },
      driverUserId,
    );

    return toJobDto(updated);
  }
}
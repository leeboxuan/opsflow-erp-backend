import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import {
  JobStatus,
  JobType,
  JobDocumentType,
  TripStatus,
  TripDocumentType,
} from "@prisma/client";
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

    trips:
      j.trips?.map((t: any) => ({
        id: t.id,
        jobSequence: t.jobSequence ?? null,
        jobTripTemplate: t.jobTripTemplate ?? null,
        title: t.title ?? null,
        status: t.status,
        plannedStartAt: t.plannedStartAt ?? null,
        startedAt: t.startedAt ?? null,
        closedAt: t.closedAt ?? null,
        trailerNumber: t.trailerNumber ?? null,
        trailerLastLocationCode: t.trailerLastLocationCode ?? null,
        driverEarningCents: t.driverEarningCents ?? null,
        earningLabelSnapshot: t.earningLabelSnapshot ?? null,
        earningRateMasterId: t.earningRateMasterId ?? null,
        completionRuleJson: t.completionRuleJson ?? null,
        documents: Array.isArray(t.documentsWithUrls)
          ? t.documentsWithUrls
          : [],
      })) ?? [],
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

  private async attachTripDocumentSignedUrl(doc: any): Promise<JobDocumentDto> {
    const base = {
      id: doc.id,
      type: doc.type,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes ?? null,
      createdAt: doc.createdAt,
      url: null as string | null,
    };
    const supabase = this.supabaseService.getClient();
    const { data } = await supabase.storage
      .from(JOB_DOCUMENTS_BUCKET)
      .createSignedUrl(doc.storageKey, 60 * 60);
    return { ...base, url: data?.signedUrl ?? null };
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
      trips: {
        orderBy: [{ jobSequence: "asc" }, { createdAt: "asc" }],
        include: {
          documents: {
            orderBy: { createdAt: "desc" },
          },
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

    const tripsWithUrls = await Promise.all(
      (job.trips ?? []).map(async (t: any) => {
        const documentsWithUrls = await Promise.all(
          (t.documents ?? []).map((d: any) =>
            this.attachTripDocumentSignedUrl(d),
          ),
        );
        return {
          ...t,
          documentsWithUrls,
        };
      }),
    );

    const dto = toJobDto({
      ...job,
      trips: tripsWithUrls,
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

    const tripCount = await this.prisma.trip.count({
      where: { tenantId, jobId },
    });
    if (tripCount > 0) {
      throw new BadRequestException(
        "This job uses trips; start the leg with POST /drivers/jobs/:jobId/trips/:tripId/start (trailer number, location, parking photo).",
      );
    }

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

  async startTripWithTrailer(
    tenantId: string,
    jobId: string,
    tripId: string,
    driverUserId: string,
    payload: {
      trailerNumber: string;
      trailerLastLocationCode: string;
      parkingPhoto: Express.Multer.File;
    },
  ): Promise<JobDto> {
    const job = await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId, {
      trips: { select: { id: true } },
    });

    const tripCount = await this.prisma.trip.count({
      where: { tenantId, jobId },
    });
    if (tripCount === 0) {
      throw new BadRequestException("This job has no trips; use POST .../start");
    }

    if (job.status !== JobStatus.Assigned && job.status !== JobStatus.InProgress) {
      throw new BadRequestException("Job must be Assigned or InProgress to start a trip");
    }

    const trailerNumber = payload.trailerNumber?.trim();
    const locCode = payload.trailerLastLocationCode?.trim();
    if (!trailerNumber) {
      throw new BadRequestException("trailerNumber is required");
    }
    if (!locCode) {
      throw new BadRequestException("trailerLastLocationCode is required");
    }

    const loc = await this.prisma.masterTrailerLocation.findFirst({
      where: { code: locCode },
    });
    if (!loc) {
      throw new BadRequestException(`Unknown trailerLastLocationCode: ${locCode}`);
    }

    const file = payload.parkingPhoto;
    if (!file?.buffer?.length) {
      throw new BadRequestException("Trailer parking photo is required");
    }
    const mime = String(file.mimetype ?? "").toLowerCase();
    if (!mime.startsWith("image/")) {
      throw new BadRequestException("Parking photo must be an image");
    }

    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
    });
    if (!trip) {
      throw new NotFoundException("Trip not found on this job");
    }
    if (trip.startedAt) {
      throw new BadRequestException("Trip already started");
    }

    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg";
    const key = `${tenantId}/jobs/${jobId}/trips/${tripId}/trailer-parking/${Date.now()}${ext}`;

    const supabase = this.supabaseService.getClient();
    const { error: upErr } = await supabase.storage
      .from(JOB_DOCUMENTS_BUCKET)
      .upload(key, file.buffer, {
        contentType: file.mimetype ?? "image/jpeg",
        upsert: false,
      });
    if (upErr) {
      throw new BadRequestException(`Storage upload failed: ${upErr.message}`);
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.tripDocument.create({
        data: {
          tenantId,
          tripId,
          type: TripDocumentType.TRAILER_PARKING_PHOTO,
          storageKey: key,
          originalName: file.originalname ?? "parking.jpg",
          mimeType: file.mimetype ?? "image/jpeg",
          sizeBytes: file.size ?? null,
          uploadedByUserId: driverUserId,
        },
      });

      await tx.trip.update({
        where: { id: tripId },
        data: {
          trailerNumber,
          trailerLastLocationCode: locCode,
          startedAt: now,
          startedByDriverUserId: driverUserId,
          status: TripStatus.InTransit,
        },
      });

      await tx.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.InProgress,
          ...(job.startedAt ? {} : { startedAt: now }),
        },
      });
    });

    await this.audit.log(
      tenantId,
      "TRIP_START",
      "TRIP",
      tripId,
      {
        jobId,
        trailerNumber,
        trailerLastLocationCode: locCode,
      },
      driverUserId,
    );

    await this.audit.log(
      tenantId,
      "TRAILER_DETAILS",
      "JOB",
      jobId,
      { tripId, trailerNumber, trailerLastLocationCode: locCode },
      driverUserId,
    );

    return this.getOneForDriver(tenantId, jobId, driverUserId);
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

    const tripCount = await this.prisma.trip.count({
      where: { tenantId, jobId },
    });
    if (tripCount > 0) {
      throw new BadRequestException(
        "This job uses trips; complete each leg with POST /drivers/jobs/:jobId/trips/:tripId/complete",
      );
    }

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

  async completeTrip(
    tenantId: string,
    jobId: string,
    tripId: string,
    driverUserId: string,
  ): Promise<JobDto> {
    const job = await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId, {
      documents: true,
    });

    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
    });
    if (!trip) throw new NotFoundException("Trip not found");

    if (trip.status !== TripStatus.InTransit) {
      throw new BadRequestException("Trip must be InTransit to complete");
    }

    const rule = (trip.completionRuleJson as Record<string, unknown>) || {};
    if (rule.requireGeneratedDoSigned) {
      const hasGeneratedDo = job.documents.some(
        (d: { type: JobDocumentType }) => d.type === JobDocumentType.DO,
      );
      const hasSig = job.documents.some(
        (d: { type: JobDocumentType }) => d.type === JobDocumentType.SIGNATURE,
      );
      if (!hasGeneratedDo || !hasSig) {
        throw new BadRequestException(
          "Generated receiver DO must exist and be signed before completing this trip",
        );
      }
    }

    const required = (rule.requiredTripUploadTypes as string[] | undefined) ?? [];
    for (const rt of required) {
      const tEnum = rt as TripDocumentType;
      const found = await this.prisma.tripDocument.findFirst({
        where: { tenantId, tripId, type: tEnum },
      });
      if (!found) {
        throw new BadRequestException(`Missing required trip document type: ${rt}`);
      }
    }

    const now = new Date();

    await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        status: TripStatus.Delivered,
        closedAt: now,
        completedByDriverUserId: driverUserId,
      },
    });

    await this.audit.log(
      tenantId,
      "TRIP_COMPLETE",
      "TRIP",
      tripId,
      { jobId },
      driverUserId,
    );

    const openTrips = await this.prisma.trip.count({
      where: {
        tenantId,
        jobId,
        status: {
          notIn: [
            TripStatus.Delivered,
            TripStatus.Closed,
            TripStatus.Cancelled,
          ],
        },
      },
    });

    if (openTrips === 0) {
      let newStatus: JobStatus;
      let completedAt: Date | null = null;
      if (job.jobType === JobType.LCL) {
        newStatus = JobStatus.Completed;
        completedAt = now;
      } else {
        newStatus = JobStatus.PendingDepot;
      }
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: newStatus,
          deliveredAt: job.deliveredAt ?? now,
          completedAt,
        },
      });
    }

    return this.getOneForDriver(tenantId, jobId, driverUserId);
  }

  async listJobDocumentsForDriver(
    tenantId: string,
    jobId: string,
    driverUserId: string,
  ): Promise<JobDocumentDto[]> {
    await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId);
    const docs = await this.prisma.jobDocument.findMany({
      where: { tenantId, jobId },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(docs.map((d) => this.attachSignedUrl(d)));
  }

  async listTripDocumentsForDriver(
    tenantId: string,
    jobId: string,
    tripId: string,
    driverUserId: string,
  ): Promise<JobDocumentDto[]> {
    await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId);
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    const docs = await this.prisma.tripDocument.findMany({
      where: { tenantId, tripId },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(docs.map((d) => this.attachTripDocumentSignedUrl(d)));
  }

  async listGeneratedDosForDriver(
    tenantId: string,
    jobId: string,
    driverUserId: string,
  ): Promise<JobDocumentDto[]> {
    await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId);
    const docs = await this.prisma.jobDocument.findMany({
      where: { tenantId, jobId, type: JobDocumentType.DO },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(docs.map((d) => this.attachSignedUrl(d)));
  }

  async uploadTripDocumentForDriver(
    tenantId: string,
    jobId: string,
    tripId: string,
    driverUserId: string,
    type: TripDocumentType,
    file: Express.Multer.File,
  ): Promise<JobDocumentDto> {
    await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId);
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
    });
    if (!trip) throw new NotFoundException("Trip not found");

    const mime = String(file.mimetype ?? "").toLowerCase();
    if (!mime.startsWith("image/") && type !== TripDocumentType.PICKUP_DO) {
      throw new BadRequestException("Unsupported file type for this trip document");
    }

    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg";
    const key = `${tenantId}/jobs/${jobId}/trips/${tripId}/${type.toLowerCase()}/${Date.now()}${ext}`;

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

    const doc = await this.prisma.tripDocument.create({
      data: {
        tenantId,
        tripId,
        type,
        storageKey: key,
        originalName: file.originalname ?? "upload",
        mimeType: file.mimetype ?? "application/octet-stream",
        sizeBytes: file.size ?? null,
        uploadedByUserId: driverUserId,
      },
    });

    await this.audit.log(
      tenantId,
      "TRIP_DOC_UPLOAD",
      "TRIP",
      tripId,
      { jobId, documentId: doc.id, type },
      driverUserId,
    );

    return this.attachTripDocumentSignedUrl(doc);
  }
}
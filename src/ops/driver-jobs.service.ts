import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import {
  JobStatus,
  JobType,
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
  const isPodSignature = d.type === TripDocumentType.POD_SIGNATURE;
  return {
    id: d.id,
    type: d.type,
    originalName: d.originalName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes ?? null,
    isActive: d.isActive ?? true,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt ?? null,
    url: d.url ?? null,
    uploadedByUserId: d.uploadedByUserId ?? null,
    uploadedByName: d.uploadedByName ?? d.uploadedByNameSnapshot ?? null,
    generatedBySystem: d.generatedBySystem ?? false,
    generatedSource: d.generatedSource ?? null,
    jobId: d.jobId ?? null,
    tripId: d.tripId ?? null,
    downloadUrl: d.downloadUrl ?? d.url ?? null,
    previewUrl: d.previewUrl ?? d.url ?? null,
    requiresSignature: isPodSignature ? false : (d.requiresSignature ?? false),
    isSigned: isPodSignature ? false : (d.isSigned ?? false),
    signedAt: isPodSignature ? null : (d.signedAt ?? null),
    signedByUserId: isPodSignature ? null : (d.signedByUserId ?? null),
    signedByName: isPodSignature ? null : (d.signedByName ?? null),
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
    invoiceReadyAt: j.invoiceReadyAt ?? null,
    isInvoiceReady: !!j.invoiceReadyAt,
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
    assignedFleetVehicleId: j.assignedFleetVehicleId ?? null,
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
        isPublished: t.status !== TripStatus.Draft,
        isCompleted:
          t.status === TripStatus.Delivered || t.status === TripStatus.Closed,
        plannedStartAt: t.plannedStartAt ?? null,
        startedAt: t.startedAt ?? null,
        closedAt: t.closedAt ?? null,
        trailerNumber: t.trailerNumber ?? null,
        trailerLastLocationCode: t.trailerLastLocationCode ?? null,
        driverEarningCents: t.driverEarningCents ?? null,
        hasDriverPayout: Number.isInteger(t.driverEarningCents),
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

  private publishedTripVisibilityWhere() {
    return {
      OR: [
        { trips: { none: {} } },
        { trips: { some: { status: { not: TripStatus.Draft } } } },
      ],
    };
  }

  private async findPublishedTripOrThrow(
    tenantId: string,
    jobId: string,
    tripId: string,
  ) {
    const trip = await this.prisma.trip.findFirst({
      where: {
        id: tripId,
        tenantId,
        jobId,
        status: { not: TripStatus.Draft },
      },
    });
    if (!trip) {
      throw new NotFoundException("Trip not found");
    }
    return trip;
  }

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
      downloadUrl: data?.signedUrl ?? null,
      previewUrl: data?.signedUrl ?? null,
    };
  }

  private async attachTripDocumentSignedUrl(doc: any): Promise<JobDocumentDto> {
    const isPodSignature = doc.type === TripDocumentType.POD_SIGNATURE;
    const base = {
      id: doc.id,
      type: doc.type,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes ?? null,
      isActive: doc.isActive ?? true,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt ?? null,
      uploadedByUserId: doc.uploadedByUserId ?? null,
      uploadedByName: doc.uploadedByNameSnapshot ?? null,
      generatedBySystem: doc.generatedBySystem ?? false,
      generatedSource: doc.generatedSource ?? null,
      jobId: doc.jobId ?? null,
      tripId: doc.tripId ?? null,
      requiresSignature: isPodSignature ? false : (doc.requiresSignature ?? false),
      isSigned: isPodSignature ? false : (doc.isSigned ?? false),
      signedAt: isPodSignature ? null : (doc.signedAt ?? null),
      signedByUserId: isPodSignature ? null : (doc.signedByUserId ?? null),
      signedByName: isPodSignature ? null : (doc.signedByName ?? null),
      url: null as string | null,
    };
    const supabase = this.supabaseService.getClient();
    const { data } = await supabase.storage
      .from(JOB_DOCUMENTS_BUCKET)
      .createSignedUrl(doc.storageKey, 60 * 60);
    return {
      ...base,
      url: data?.signedUrl ?? null,
      downloadUrl: data?.signedUrl ?? null,
      previewUrl: data?.signedUrl ?? null,
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
        ...this.publishedTripVisibilityWhere(),
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
      ...this.publishedTripVisibilityWhere(),
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
            where: { isActive: true, type: { in: ["QUOTATION", "OTHER"] } },
            orderBy: { createdAt: "desc" },
          },
        },
      }),
    ]);

    const vehicleIds = [...new Set(jobs.map((j) => j.assignedVehicleId).filter(Boolean))] as string[];
    const fleetVehicleIds = [...new Set(jobs.map((j) => j.assignedFleetVehicleId).filter(Boolean))] as string[];

    const [vehicles, fleetVehicles] = await this.prisma.$transaction([
      vehicleIds.length
        ? this.prisma.vehicle.findMany({
            where: {
              tenantId,
              id: { in: vehicleIds },
            },
            select: {
              id: true,
              plateNo: true,
            },
          })
        : Promise.resolve([] as Array<{ id: string; plateNo: string }>),
      fleetVehicleIds.length
        ? this.prisma.fleetVehicle.findMany({
            where: { tenantId, id: { in: fleetVehicleIds } },
            select: { id: true, plateNo: true },
          })
        : Promise.resolve([] as Array<{ id: string; plateNo: string }>),
    ]);

    const vehicleMap = new Map([
      ...vehicles.map((v) => [v.id, v.plateNo] as const),
      ...fleetVehicles.map((v) => [v.id, v.plateNo] as const),
    ]);

    const data = await Promise.all(jobs.map(async (job: any) => {
      const dto = toJobDto({
        ...job,
        assignedVehiclePlateNo:
          (job.assignedVehicleId && vehicleMap.get(job.assignedVehicleId)) ||
          (job.assignedFleetVehicleId && vehicleMap.get(job.assignedFleetVehicleId)) ||
          null,
      });

      return {
        ...dto,
        documents: await Promise.all(
          (job.documents ?? []).map((doc: any) => this.attachSignedUrl(doc)),
        ),
      };
    }));

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
      ...this.publishedTripVisibilityWhere(),
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
            where: { isActive: true, type: { in: ["QUOTATION", "OTHER"] } },
            orderBy: { createdAt: "desc" },
          },
        },
      }),
    ]);

    const vehicleIds = [...new Set(jobs.map((j) => j.assignedVehicleId).filter(Boolean))] as string[];
    const fleetVehicleIds = [...new Set(jobs.map((j) => j.assignedFleetVehicleId).filter(Boolean))] as string[];

    const [vehicles, fleetVehicles] = await this.prisma.$transaction([
      vehicleIds.length
        ? this.prisma.vehicle.findMany({
            where: { tenantId, id: { in: vehicleIds } },
            select: { id: true, plateNo: true },
          })
        : Promise.resolve([] as Array<{ id: string; plateNo: string }>),
      fleetVehicleIds.length
        ? this.prisma.fleetVehicle.findMany({
            where: { tenantId, id: { in: fleetVehicleIds } },
            select: { id: true, plateNo: true },
          })
        : Promise.resolve([] as Array<{ id: string; plateNo: string }>),
    ]);

    const vehicleMap = new Map([
      ...vehicles.map((v) => [v.id, v.plateNo] as const),
      ...fleetVehicles.map((v) => [v.id, v.plateNo] as const),
    ]);

    const data = await Promise.all(jobs.map(async (job: any) => {
      const dto = toJobDto({
        ...job,
        assignedVehiclePlateNo:
          (job.assignedVehicleId && vehicleMap.get(job.assignedVehicleId)) ||
          (job.assignedFleetVehicleId &&
            vehicleMap.get(job.assignedFleetVehicleId)) ||
          null,
      });

      return {
        ...dto,
        documents: await Promise.all(
          (job.documents ?? []).map((doc: any) => this.attachSignedUrl(doc)),
        ),
      };
    }));

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
        where: { isActive: true },
        orderBy: {
          createdAt: "desc",
        },
      },
      trips: {
        where: { status: { not: TripStatus.Draft } },
        orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }],
        include: {
          documents: {
            where: { isActive: true },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    });

    let assignedVehiclePlateNo: string | null = null;

    if (job.assignedVehicleId || job.assignedFleetVehicleId) {
      const [vehicle, fleetVehicle] = await this.prisma.$transaction([
        job.assignedVehicleId
          ? this.prisma.vehicle.findFirst({
              where: {
                id: job.assignedVehicleId,
                tenantId,
              },
              select: {
                plateNo: true,
              },
            })
          : Promise.resolve(null),
        job.assignedFleetVehicleId
          ? this.prisma.fleetVehicle.findFirst({
              where: {
                id: job.assignedFleetVehicleId,
                tenantId,
              },
              select: {
                plateNo: true,
              },
            })
          : Promise.resolve(null),
      ]);

      assignedVehiclePlateNo = vehicle?.plateNo ?? fleetVehicle?.plateNo ?? null;
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
      where: { tenantId, jobId, status: { not: TripStatus.Draft } },
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
      where: { tenantId, jobId, status: { not: TripStatus.Draft } },
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

    const trip = await this.findPublishedTripOrThrow(tenantId, jobId, tripId);
    if (trip.status !== TripStatus.Planned && trip.status !== TripStatus.Dispatched) {
      throw new BadRequestException("Trip must be published and ready to start");
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

  async complete(
    tenantId: string,
    jobId: string,
    driverUserId: string,
  ): Promise<JobDto> {
    const job = await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId, {
      documents: true,
    });

    const tripCount = await this.prisma.trip.count({
      where: { tenantId, jobId, status: { not: TripStatus.Draft } },
    });
    if (tripCount > 0) {
      throw new BadRequestException(
        "This job uses trips; complete each leg with POST /drivers/jobs/:jobId/trips/:tripId/complete",
      );
    }

    if (job.status !== JobStatus.InProgress) {
      throw new BadRequestException("Job must be InProgress to complete");
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

    const trip = await this.findPublishedTripOrThrow(tenantId, jobId, tripId);

    if (trip.status !== TripStatus.InTransit) {
      throw new BadRequestException("Trip must be InTransit to complete");
    }

    const missing: string[] = [];
    const requiredTripDocs = await this.prisma.tripDocument.findMany({
      where: {
        tenantId,
        tripId,
        isActive: true,
        type: { in: [TripDocumentType.DELIVERY_DO, TripDocumentType.POD_SIGNATURE] },
      },
      select: { type: true },
    });
    const uploadedTypes = new Set(requiredTripDocs.map((d) => d.type));
    if (!uploadedTypes.has(TripDocumentType.DELIVERY_DO)) {
      missing.push("DELIVERY_DO");
    }
    if (!uploadedTypes.has(TripDocumentType.POD_SIGNATURE)) {
      missing.push("POD_SIGNATURE");
    }

    if (missing.length > 0) {
      throw new BadRequestException(
        `Trip cannot be completed yet. Missing required trip documents: ${missing.join(", ")}`,
      );
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
      where: { tenantId, jobId, isActive: true, type: { in: ["QUOTATION", "OTHER"] } },
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
    await this.findPublishedTripOrThrow(tenantId, jobId, tripId);
    const docs = await this.prisma.tripDocument.findMany({
      where: {
        tenantId,
        tripId,
        isActive: true,
        type: {
          in: [
            TripDocumentType.PICKUP_DO,
            TripDocumentType.DELIVERY_DO,
            TripDocumentType.POD_PHOTO,
            TripDocumentType.POD_SIGNATURE,
            TripDocumentType.OTHER,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(docs.map((d) => this.attachTripDocumentSignedUrl(d)));
  }

  async uploadTripDocumentForDriver(
    tenantId: string,
    jobId: string,
    tripId: string,
    driverUserId: string,
    type: TripDocumentType,
    file: Express.Multer.File,
    requiresSignature = false,
  ): Promise<JobDocumentDto> {
    await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId);
    await this.findPublishedTripOrThrow(tenantId, jobId, tripId);

    const allowedTypes = new Set<TripDocumentType>([
      TripDocumentType.PICKUP_DO,
      TripDocumentType.DELIVERY_DO,
      TripDocumentType.POD_PHOTO,
      TripDocumentType.POD_SIGNATURE,
      TripDocumentType.OTHER,
    ]);
    if (!allowedTypes.has(type)) {
      throw new BadRequestException("Unsupported trip document type");
    }
    const singleActiveTripTypes = new Set<TripDocumentType>([
      TripDocumentType.PICKUP_DO,
      TripDocumentType.DELIVERY_DO,
      TripDocumentType.POD_SIGNATURE,
    ]);

    const mime = String(file.mimetype ?? "").toLowerCase();
    if (
      !mime.startsWith("image/") &&
      type !== TripDocumentType.PICKUP_DO &&
      type !== TripDocumentType.DELIVERY_DO &&
      type !== TripDocumentType.OTHER
    ) {
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
    if (singleActiveTripTypes.has(type)) {
      await this.prisma.tripDocument.updateMany({
        where: { tenantId, tripId, type, isActive: true },
        data: { isActive: false },
      });
    }

    const doc = await this.prisma.tripDocument.create({
      data: {
        tenantId,
        tripId,
        type,
        isActive: true,
        storageKey: key,
        originalName: file.originalname ?? "upload",
        mimeType: file.mimetype ?? "application/octet-stream",
        sizeBytes: file.size ?? null,
        uploadedByUserId: driverUserId,
        uploadedByNameSnapshot: null,
        requiresSignature:
          type === TripDocumentType.POD_SIGNATURE
            ? false
            : !!requiresSignature,
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

  async signTripDocumentForDriver(
    tenantId: string,
    jobId: string,
    tripId: string,
    documentId: string,
    driverUserId: string,
    signedByName?: string,
  ): Promise<JobDocumentDto> {
    await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId);
    await this.findPublishedTripOrThrow(tenantId, jobId, tripId);
    const doc = await this.prisma.tripDocument.findFirst({
      where: { id: documentId, tenantId, tripId, isActive: true },
    });
    if (!doc) throw new NotFoundException("Trip document not found");
    if (doc.type === TripDocumentType.POD_SIGNATURE) {
      throw new BadRequestException(
        "POD_SIGNATURE is the canonical signature artifact and cannot be signed separately",
      );
    }
    const updated = await this.prisma.tripDocument.update({
      where: { id: documentId },
      data: {
        isSigned: true,
        signedAt: new Date(),
        signedByUserId: driverUserId,
        signedByName: signedByName?.trim() || null,
      },
    });
    await this.audit.log(
      tenantId,
      "TRIP_DOC_SIGN",
      "TRIP",
      tripId,
      { jobId, documentId },
      driverUserId,
    );
    return this.attachTripDocumentSignedUrl(updated);
  }
}
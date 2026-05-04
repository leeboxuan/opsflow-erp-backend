import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import {
  JobStatus,
  Prisma,
  TripPendingState,
  TripStatus,
  TripDocumentType,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { parsePaginationFromQuery, buildPaginationMeta } from "../common/pagination";
import { buildOrderBy } from "../common/listing/listing.sort";
import { AuditService } from "../audit/audit.service";
import { SupabaseService } from "../auth/supabase.service";
import { buildDocumentFileDisplayFields } from "../common/document-file-display";
import { JobLocationDto } from "./dto/location.dto";
import { JobDto, JobDocumentDto } from "./dto/job.dto";

const JOB_DOCUMENTS_BUCKET = "job-documents";

function normalizeText(value?: string | null): string | null {
  if (!value) return null;
  return value.replace(/\s+/g, " ").trim();
}

function toDocDto(d: any): JobDocumentDto {
  const isPodSignature = d.type === TripDocumentType.POD_SIGNATURE;
  const fileDisplay =
    typeof d.storageKey === "string" && d.storageKey
      ? buildDocumentFileDisplayFields(d)
      : null;
  return {
    id: d.id,
    type: d.type,
    originalName: d.originalName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes ?? null,
    ...(fileDisplay ?? {}),
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
  const trips = Array.isArray(j.trips) ? j.trips : [];
  const primaryTrip =
    trips.find((t: any) => t.status !== TripStatus.DRAFT && t.status !== TripStatus.CANCELLED)
    ?? trips[0]
    ?? null;

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

    assignedDriverId: primaryTrip?.assignedDriverUserId ?? null,
    assignedDriverName: j.assignedDriver?.name ?? null,
    assignedVehicleId: primaryTrip?.vehicleId ?? null,
    assignedFleetVehicleId: primaryTrip?.fleetVehicleId ?? null,
    assignedVehiclePlateNo: (j as any).assignedVehiclePlateNo ?? null,

    assignedAt: primaryTrip?.assignedAt ?? null,
    startedAt: null,
    completedAt: null,
    deliveredAt: null,
    podRecipientName: null,

    cancelledReason: j.cancelledReason ?? null,
    cancelledAt: j.cancelledAt ?? null,
    cancelledByUserId: j.cancelledByUserId ?? null,

    lastLat: null,
    lastLng: null,
    lastLocationAt: null,

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
      trips.map((t: any) => ({
        id: t.id,
        jobSequence: t.jobSequence ?? null,
        jobTripTemplate: t.jobTripTemplate ?? null,
        title: t.title ?? null,
        status: t.status,
        isPublished: t.status !== TripStatus.DRAFT && t.status !== TripStatus.CANCELLED,
        isCompleted:
          t.status === TripStatus.COMPLETED || t.status === TripStatus.DONE,
        pendingState: t.pendingState ?? TripPendingState.NONE,
        canPublish: false,
        canMarkDone: false,
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
        { trips: { some: { status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] } } } },
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
        status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] },
      },
    });
    if (!trip) {
      throw new NotFoundException("Trip not found");
    }
    return trip;
  }

  /** Signature on a signable DO (not standalone POD_SIGNATURE artifact). */
  private isSignableDoMarkedSigned(doc: {
    type: TripDocumentType;
    signedAt: Date | null;
    isSigned: boolean;
  }): boolean {
    if (
      doc.type !== TripDocumentType.DELIVERY_DO
      && doc.type !== TripDocumentType.PICKUP_DO
    ) {
      return false;
    }
    return !!doc.signedAt || doc.isSigned === true;
  }

  /**
   * Customer signature requirement is met if:
   * - a standalone POD_SIGNATURE upload exists (legacy), or
   * - any active DELIVERY_DO or PICKUP_DO is signed (signedAt or isSigned).
   */
  private customerSignatureRequirementMet(
    docs: Array<{ type: TripDocumentType; signedAt: Date | null; isSigned: boolean }>,
  ): boolean {
    if (docs.some((d) => d.type === TripDocumentType.POD_SIGNATURE)) {
      return true;
    }
    return docs.some((d) => this.isSignableDoMarkedSigned(d));
  }

  private buildTripCompletionDocumentGaps(
    docs: Array<{ type: TripDocumentType; signedAt: Date | null; isSigned: boolean }>,
  ): string[] {
    const missing: string[] = [];
    const hasDeliveryDo = docs.some((d) => d.type === TripDocumentType.DELIVERY_DO);
    if (!hasDeliveryDo) {
      missing.push("DELIVERY_DO");
      return missing;
    }
    if (!this.customerSignatureRequirementMet(docs)) {
      missing.push("POD_SIGNATURE");
    }
    return missing;
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

  private getSafeTenantTimezone(value?: string | null): string {
    const fallback = "Asia/Singapore";
    const timezone = value?.trim() || fallback;
    try {
      // Throws when timezone is invalid.
      Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
      return timezone;
    } catch {
      return fallback;
    }
  }

  private getTimeZoneOffsetMs(date: Date, timeZone: string): number {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(date);
    const map = new Map(parts.map((p) => [p.type, p.value] as const));
    const asUtc = Date.UTC(
      Number(map.get("year")),
      Number(map.get("month")) - 1,
      Number(map.get("day")),
      Number(map.get("hour")),
      Number(map.get("minute")),
      Number(map.get("second")),
    );
    return asUtc - date.getTime();
  }

  private zonedDateTimeToUtc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    timeZone: string,
  ): Date {
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
    const offset = this.getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
    return new Date(utcGuess - offset);
  }

  private getTenantDayWindow(referenceDate: Date, timeZone: string): { gte: Date; lt: Date } {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = dtf.formatToParts(referenceDate);
    const map = new Map(parts.map((p) => [p.type, p.value] as const));
    const year = Number(map.get("year"));
    const month = Number(map.get("month"));
    const day = Number(map.get("day"));
    const start = this.zonedDateTimeToUtc(year, month, day, 0, 0, 0, timeZone);
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
    const nextParts = dtf.formatToParts(nextDay);
    const nextMap = new Map(nextParts.map((p) => [p.type, p.value] as const));
    const end = this.zonedDateTimeToUtc(
      Number(nextMap.get("year")),
      Number(nextMap.get("month")),
      Number(nextMap.get("day")),
      0,
      0,
      0,
      timeZone,
    );
    return { gte: start, lt: end };
  }

  private async getDriverDayOpenTripsByWindow(
    tenantId: string,
    driverUserId: string,
    dayWindow: { gte: Date; lt: Date },
  ) {
    return this.prisma.trip.findMany({
      where: {
        tenantId,
        assignedDriverUserId: driverUserId,
        status: { notIn: [TripStatus.COMPLETED, TripStatus.DONE, TripStatus.CANCELLED] },
        OR: [
          { plannedStartAt: { gte: dayWindow.gte, lt: dayWindow.lt } },
          { plannedStartAt: null, createdAt: { gte: dayWindow.gte, lt: dayWindow.lt } },
        ],
      },
      select: { id: true, plannedStartAt: true, createdAt: true },
    });
  }

  private async getTenantTimeZone(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return this.getSafeTenantTimezone(tenant?.timezone);
  }

  private buildActiveTripExecutionRangeWhere(range: { gte: Date; lt: Date }) {
    return {
      OR: [
        {
          trips: {
            some: {
              status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] },
              plannedStartAt: { gte: range.gte, lt: range.lt },
            },
          },
        },
        {
          AND: [
            {
              trips: {
                none: {
                  status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] },
                  plannedStartAt: { not: null },
                },
              },
            },
            {
              pickupDate: { gte: range.gte, lt: range.lt },
            },
          ],
        },
      ],
    };
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
    const fileDisplay = buildDocumentFileDisplayFields(doc);
    const base = {
      id: doc.id,
      type: doc.type,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes ?? null,
      ...fileDisplay,
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
        trips: {
          some: {
            status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] },
            assignedDriverUserId: driverUserId,
          },
        },
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
      in: [JobStatus.ONGOING],
    };

    const where: any = {
      tenantId,
      status: statusFilter,
      ...this.publishedTripVisibilityWhere(),
      trips: {
        some: {
          status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] },
          assignedDriverUserId: driverUserId,
        },
      },
    };

    // Filtering rules:
    // - month: pickupDate within that month
    // - date: pickupDate within that day
    // - none: all jobs for the driver
    const month = query?.month?.trim();
    const dateStr = query?.date?.trim();

    if (month) {
      where.AND = [...(where.AND ?? []), this.buildActiveTripExecutionRangeWhere(this.parseMonthToRange(month))];
    } else if (dateStr) {
      where.AND = [...(where.AND ?? []), this.buildActiveTripExecutionRangeWhere(this.parseDateToRange(dateStr))];
    }

    const sortBy = query?.sortBy ?? "pickupDate";
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

    const includeActiveJobRelations = {
      customerCompany: {
        select: { id: true, name: true },
      },
      assignedDriver: {
        select: { id: true, name: true },
      },
      trips: {
        where: { status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] } },
        orderBy: [{ plannedStartAt: "asc" as const }, { createdAt: "asc" as const }],
      },
      items: {
        orderBy: { createdAt: "asc" as const },
      },
      documents: {
        where: { isActive: true, type: { in: ["QUOTATION", "OTHER"] } },
        orderBy: { createdAt: "desc" as const },
      },
    };

    const total = await this.prisma.job.count({ where });
    let jobs: any[] = [];

    if (sortBy === "pickupDate") {
      const dirSql = (query?.sortDir ?? "asc").toLowerCase() === "desc"
        ? Prisma.sql`DESC`
        : Prisma.sql`ASC`;

      let rangeSql = Prisma.empty;
      if (month) {
        const range = this.parseMonthToRange(month);
        rangeSql = Prisma.sql`
          AND (
            EXISTS (
              SELECT 1
              FROM trips t
              WHERE t."jobId" = j.id
                AND t."status"::text <> ${TripStatus.DRAFT}
                AND t."status"::text <> ${TripStatus.CANCELLED}
                AND t."plannedStartAt" >= ${range.gte}
                AND t."plannedStartAt" < ${range.lt}
            )
            OR (
              NOT EXISTS (
                SELECT 1
                FROM trips tp
                WHERE tp."jobId" = j.id
                  AND tp."status"::text <> ${TripStatus.DRAFT}
                  AND tp."status"::text <> ${TripStatus.CANCELLED}
                  AND tp."plannedStartAt" IS NOT NULL
              )
              AND j."pickupDate" >= ${range.gte}
              AND j."pickupDate" < ${range.lt}
            )
          )
        `;
      } else if (dateStr) {
        const range = this.parseDateToRange(dateStr);
        rangeSql = Prisma.sql`
          AND (
            EXISTS (
              SELECT 1
              FROM trips t
              WHERE t."jobId" = j.id
                AND t."status"::text <> ${TripStatus.DRAFT}
                AND t."status"::text <> ${TripStatus.CANCELLED}
                AND t."plannedStartAt" >= ${range.gte}
                AND t."plannedStartAt" < ${range.lt}
            )
            OR (
              NOT EXISTS (
                SELECT 1
                FROM trips tp
                WHERE tp."jobId" = j.id
                  AND tp."status"::text <> ${TripStatus.DRAFT}
                  AND tp."status"::text <> ${TripStatus.CANCELLED}
                  AND tp."plannedStartAt" IS NOT NULL
              )
              AND j."pickupDate" >= ${range.gte}
              AND j."pickupDate" < ${range.lt}
            )
          )
        `;
      }

      const sortedJobIds = (await this.prisma.$queryRaw(Prisma.sql`
        SELECT j.id
        FROM jobs j
        WHERE
          j."tenantId" = ${tenantId}
          AND EXISTS (
            SELECT 1
            FROM trips ta
            WHERE ta."jobId" = j.id
              AND ta."status"::text <> ${TripStatus.DRAFT}
              AND ta."status"::text <> ${TripStatus.CANCELLED}
              AND ta."assignedDriverUserId" = ${driverUserId}
          )
          AND j."status"::text IN (${Prisma.join([JobStatus.ONGOING])})
          AND (
            NOT EXISTS (SELECT 1 FROM trips tv WHERE tv."jobId" = j.id)
            OR EXISTS (
              SELECT 1
              FROM trips tv
              WHERE tv."jobId" = j.id
                AND tv."status"::text <> ${TripStatus.DRAFT}
                AND tv."status"::text <> ${TripStatus.CANCELLED}
            )
          )
          ${rangeSql}
        ORDER BY
          COALESCE(
            (
              SELECT MIN(t1."plannedStartAt")
              FROM trips t1
              WHERE t1."jobId" = j.id
                AND t1."status"::text <> ${TripStatus.DRAFT}
                AND t1."status"::text <> ${TripStatus.CANCELLED}
                AND t1."plannedStartAt" IS NOT NULL
            ),
            j."pickupDate"
          ) ${dirSql} NULLS LAST,
          j."createdAt" ASC
        OFFSET ${skip}
        LIMIT ${take}
      `)) as Array<{ id: string }>;

      const ids = sortedJobIds.map((row) => row.id);
      if (ids.length) {
        const fetchedJobs = await this.prisma.job.findMany({
          where: { id: { in: ids } },
          include: includeActiveJobRelations,
        });
        const orderMap = new Map(ids.map((id, idx) => [id, idx] as const));
        jobs = fetchedJobs.sort(
          (a, b) => Number(orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER)
            - Number(orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        );
      }
    } else {
      jobs = await this.prisma.job.findMany({
        where,
        orderBy: orderByFinal as any,
        skip,
        take,
        include: includeActiveJobRelations,
      });
    }

    const vehicleIds = [
      ...new Set(
        jobs.flatMap((j) => (j.trips ?? []).map((t: any) => t.vehicleId)).filter(Boolean),
      ),
    ] as string[];
    const fleetVehicleIds = [
      ...new Set(
        jobs.flatMap((j) => (j.trips ?? []).map((t: any) => t.fleetVehicleId)).filter(Boolean),
      ),
    ] as string[];

    const [vehicles, fleetVehicles] = await Promise.all([
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
        : ([] as Array<{ id: string; plateNo: string }>),
      fleetVehicleIds.length
        ? this.prisma.fleetVehicle.findMany({
            where: { tenantId, id: { in: fleetVehicleIds } },
            select: { id: true, plateNo: true },
          })
        : ([] as Array<{ id: string; plateNo: string }>),
    ]);

    const vehicleMap = new Map([
      ...vehicles.map((v) => [v.id, v.plateNo] as const),
      ...fleetVehicles.map((v) => [v.id, v.plateNo] as const),
    ]);

    const data = await Promise.all(jobs.map(async (job: any) => {
      const dto = toJobDto({
        ...job,
        assignedVehiclePlateNo: (() => {
          const primaryTrip = (job.trips ?? []).find(
            (t: any) => t.status !== TripStatus.DRAFT && t.status !== TripStatus.CANCELLED,
          );
          return (
            (primaryTrip?.vehicleId && vehicleMap.get(primaryTrip.vehicleId)) ||
            (primaryTrip?.fleetVehicleId && vehicleMap.get(primaryTrip.fleetVehicleId)) ||
            null
          );
        })(),
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
      status: JobStatus.COMPLETED,
      ...this.publishedTripVisibilityWhere(),
      trips: {
        some: {
          status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] },
          assignedDriverUserId: driverUserId,
        },
      },
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

    const vehicleIds = [
      ...new Set(
        jobs.flatMap((j) => (j.trips ?? []).map((t: any) => t.vehicleId)).filter(Boolean),
      ),
    ] as string[];
    const fleetVehicleIds = [
      ...new Set(
        jobs.flatMap((j) => (j.trips ?? []).map((t: any) => t.fleetVehicleId)).filter(Boolean),
      ),
    ] as string[];

    const [vehicles, fleetVehicles] = await Promise.all([
      vehicleIds.length
        ? this.prisma.vehicle.findMany({
            where: { tenantId, id: { in: vehicleIds } },
            select: { id: true, plateNo: true },
          })
        : ([] as Array<{ id: string; plateNo: string }>),
      fleetVehicleIds.length
        ? this.prisma.fleetVehicle.findMany({
            where: { tenantId, id: { in: fleetVehicleIds } },
            select: { id: true, plateNo: true },
          })
        : ([] as Array<{ id: string; plateNo: string }>),
    ]);

    const vehicleMap = new Map([
      ...vehicles.map((v) => [v.id, v.plateNo] as const),
      ...fleetVehicles.map((v) => [v.id, v.plateNo] as const),
    ]);

    const data = await Promise.all(jobs.map(async (job: any) => {
      const dto = toJobDto({
        ...job,
        assignedVehiclePlateNo: (() => {
          const primaryTrip = (job.trips ?? []).find(
            (t: any) => t.status !== TripStatus.DRAFT && t.status !== TripStatus.CANCELLED,
          );
          return (
            (primaryTrip?.vehicleId && vehicleMap.get(primaryTrip.vehicleId)) ||
            (primaryTrip?.fleetVehicleId && vehicleMap.get(primaryTrip.fleetVehicleId)) ||
            null
          );
        })(),
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
        AND id IN (
          SELECT DISTINCT t."jobId"
          FROM trips t
          WHERE t."tenantId" = ${tenantId}
            AND t."assignedDriverUserId" = ${driverUserId}
            AND t."status"::text <> ${TripStatus.DRAFT}
            AND t."status"::text <> ${TripStatus.CANCELLED}
        )
        AND "status"::text = 'COMPLETED'
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
        where: { status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] } },
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
    const primaryTrip = (job.trips ?? []).find(
      (t: any) => t.status !== TripStatus.DRAFT && t.status !== TripStatus.CANCELLED,
    );
    if (primaryTrip?.vehicleId || primaryTrip?.fleetVehicleId) {
      const [vehicle, fleetVehicle] = await Promise.all([
        primaryTrip?.vehicleId
          ? this.prisma.vehicle.findFirst({
              where: {
                id: primaryTrip.vehicleId,
                tenantId,
              },
              select: {
                plateNo: true,
              },
            })
          : null,
        primaryTrip?.fleetVehicleId
          ? this.prisma.fleetVehicle.findFirst({
              where: {
                id: primaryTrip.fleetVehicleId,
                tenantId,
              },
              select: {
                plateNo: true,
              },
            })
          : null,
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
      where: { tenantId, jobId, status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] } },
    });
    if (tripCount > 0) {
      throw new BadRequestException(
        "This job uses trips; start the leg with POST /drivers/jobs/:jobId/trips/:tripId/start (trailer number, location, parking photo).",
      );
    }

    if (job.status !== JobStatus.ONGOING) {
      throw new BadRequestException("Job must be ONGOING to start");
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.ONGOING,
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
      trailerPhoto: Express.Multer.File;
    },
  ): Promise<JobDto> {
    const job = await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId, {
      trips: { select: { id: true } },
    });

    const tripCount = await this.prisma.trip.count({
      where: { tenantId, jobId, status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] } },
    });
    if (tripCount === 0) {
      throw new BadRequestException("This job has no trips; use POST .../start");
    }

    if (job.status !== JobStatus.ONGOING) {
      throw new BadRequestException("Job must be ONGOING to start a trip");
    }

    const trailerNumber = payload.trailerNumber?.trim();
    if (!trailerNumber) {
      throw new BadRequestException("trailerNumber is required");
    }

    const file = payload.trailerPhoto;
    if (!file?.buffer?.length) {
      throw new BadRequestException("trailerPhoto is required");
    }
    const mime = String(file.mimetype ?? "").toLowerCase();
    if (!mime.startsWith("image/")) {
      throw new BadRequestException("trailerPhoto must be an image");
    }

    const trip = await this.findPublishedTripOrThrow(tenantId, jobId, tripId);
    if (trip.assignedDriverUserId !== driverUserId) {
      throw new BadRequestException("You are not assigned to this trip");
    }
    if (trip.status !== TripStatus.PUBLISHED) {
      throw new BadRequestException("Trip must be published and ready to start");
    }
    if (trip.startedAt) {
      throw new BadRequestException("Trip already started");
    }

    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg";
    const key = `${tenantId}/jobs/${jobId}/trips/${tripId}/trailer-start/${Date.now()}${ext}`;

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
          type: TripDocumentType.TRAILER_START_PHOTO,
          storageKey: key,
          originalName: file.originalname ?? "trailer-start.jpg",
          mimeType: file.mimetype ?? "image/jpeg",
          sizeBytes: file.size ?? null,
          uploadedByUserId: driverUserId,
        },
      });

      await tx.trip.update({
        where: { id: tripId },
        data: {
          trailerNumber,
          startedAt: now,
          startedByDriverUserId: driverUserId,
          status: TripStatus.ONGOING,
        },
      });

      await tx.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.ONGOING,
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
      },
      driverUserId,
    );

    await this.audit.log(
      tenantId,
      "TRIP_TRAILER_CHECK_IN",
      "TRIP",
      tripId,
      { jobId, trailerNumber },
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

    const now = new Date();
    await this.prisma.driverLocationLatest.upsert({
      where: {
        tenantId_driverUserId: {
          tenantId,
          driverUserId,
        },
      },
      create: {
        tenantId,
        driverUserId,
        lat: dto.lat,
        lng: dto.lng,
        capturedAt: now,
      },
      update: {
        lat: dto.lat,
        lng: dto.lng,
        capturedAt: now,
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
      where: { tenantId, jobId, status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] } },
    });
    if (tripCount > 0) {
      throw new BadRequestException(
        "This job uses trips; complete each leg with POST /drivers/jobs/:jobId/trips/:tripId/complete",
      );
    }

    if (job.status !== JobStatus.ONGOING) {
      throw new BadRequestException("Job must be ONGOING to complete");
    }

    const now = new Date();
    const newStatus: JobStatus = JobStatus.READY_FOR_INVOICE;
    const completedAt: Date | null = null;

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: newStatus,
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
    payload?: {
      trailerParkingLocationCode?: string;
      trailerParkingLat?: number;
      trailerParkingLng?: number;
      trailerEndPhoto?: Express.Multer.File;
    },
  ): Promise<{ requiresTrailerCheckout: boolean; trip: any; job: JobDto }> {
    const job = await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId, {
      documents: true,
    });

    const trip = await this.findPublishedTripOrThrow(tenantId, jobId, tripId);
    if (trip.assignedDriverUserId !== driverUserId) {
      throw new BadRequestException("You are not assigned to this trip");
    }

    if (trip.status !== TripStatus.ONGOING) {
      throw new BadRequestException("Trip must be ONGOING to complete");
    }

    const completionDocs = await this.prisma.tripDocument.findMany({
      where: {
        tenantId,
        tripId,
        isActive: true,
        type: {
          in: [
            TripDocumentType.DELIVERY_DO,
            TripDocumentType.POD_SIGNATURE,
            TripDocumentType.PICKUP_DO,
          ],
        },
      },
      select: { type: true, signedAt: true, isSigned: true },
    });
    const missing = this.buildTripCompletionDocumentGaps(completionDocs);

    if (missing.length > 0) {
      throw new BadRequestException(
        `Trip cannot be completed yet. Missing required trip documents: ${missing.join(", ")}`,
      );
    }

    const referenceDate = trip.plannedStartAt ?? trip.createdAt;
    const tenantTimeZone = await this.getTenantTimeZone(tenantId);
    const dayWindow = this.getTenantDayWindow(referenceDate, tenantTimeZone);
    const driverDayOpenTrips = await this.getDriverDayOpenTripsByWindow(
      tenantId,
      driverUserId,
      dayWindow,
    );
    const requiresTrailerCheckout = driverDayOpenTrips.length === 1;
    const missingTrailerCheckoutFields: string[] = [];

    let trailerLocation: { code: string; name: string } | null = null;
    if (requiresTrailerCheckout) {
      const trailerEndPhoto = payload?.trailerEndPhoto;
      const trailerParkingLocationCode = payload?.trailerParkingLocationCode?.trim();
      if (!trailerEndPhoto?.buffer?.length) {
        missingTrailerCheckoutFields.push("trailerEndPhoto");
      }
      if (!trailerParkingLocationCode) {
        missingTrailerCheckoutFields.push("trailerParkingLocationCode");
      }
      if (missingTrailerCheckoutFields.length > 0) {
        throw new BadRequestException(
          `Missing trailer checkout fields: ${missingTrailerCheckoutFields.join(", ")}`,
        );
      }
      const mime = String(trailerEndPhoto.mimetype ?? "").toLowerCase();
      if (!mime.startsWith("image/")) {
        throw new BadRequestException("trailerEndPhoto must be an image");
      }

      const location = await this.prisma.masterTrailerLocation.findFirst({
        where: { code: trailerParkingLocationCode },
        select: { code: true, name: true },
      });
      if (!location) {
        throw new BadRequestException(
          `Unknown trailerParkingLocationCode: ${trailerParkingLocationCode}`,
        );
      }
      trailerLocation = location;
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (requiresTrailerCheckout && payload?.trailerEndPhoto && trailerLocation) {
        const file = payload.trailerEndPhoto;
        const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg";
        const key = `${tenantId}/jobs/${jobId}/trips/${tripId}/trailer-end/${Date.now()}${ext}`;
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
        await tx.tripDocument.create({
          data: {
            tenantId,
            tripId,
            type: TripDocumentType.TRAILER_END_PHOTO,
            storageKey: key,
            originalName: file.originalname ?? "trailer-end.jpg",
            mimeType: file.mimetype ?? "image/jpeg",
            sizeBytes: file.size ?? null,
            uploadedByUserId: driverUserId,
          },
        });
      }

      await tx.trip.update({
        where: { id: tripId },
        data: {
          status: TripStatus.COMPLETED,
          pendingState: TripPendingState.NONE,
          trailerLastLocationCode: trailerLocation?.code ?? undefined,
          trailerParkingLat: requiresTrailerCheckout ? (payload?.trailerParkingLat ?? null) : undefined,
          trailerParkingLng: requiresTrailerCheckout ? (payload?.trailerParkingLng ?? null) : undefined,
          trailerParkedAt: requiresTrailerCheckout ? now : undefined,
          closedAt: now,
          completedByDriverUserId: driverUserId,
        },
      });
    });

    await this.audit.log(
      tenantId,
      "TRIP_COMPLETE",
      "TRIP",
      tripId,
      { jobId },
      driverUserId,
    );
    if (requiresTrailerCheckout) {
      await this.audit.log(
        tenantId,
        "TRIP_TRAILER_CHECK_OUT",
        "TRIP",
        tripId,
        {
          jobId,
          trailerNumber: trip.trailerNumber ?? null,
          trailerParkingLocationCode: trailerLocation?.code ?? null,
          trailerParkingLocationName: trailerLocation?.name ?? null,
          trailerParkingLat: payload?.trailerParkingLat ?? null,
          trailerParkingLng: payload?.trailerParkingLng ?? null,
        },
        driverUserId,
      );
    }

    const openTrips = await this.prisma.trip.count({
      where: {
        tenantId,
        jobId,
        status: {
          notIn: [
            TripStatus.COMPLETED,
            TripStatus.DONE,
            TripStatus.CANCELLED,
          ],
        },
      },
    });

    if (openTrips === 0) {
      const newStatus: JobStatus = JobStatus.ONGOING;
      const completedAt: Date | null = null;
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: newStatus,
          completedAt,
        },
      });
    }

    const refreshedJob = await this.getOneForDriver(tenantId, jobId, driverUserId);
    const refreshedTrip = refreshedJob.trips.find((t) => t.id === tripId) ?? null;
    return {
      requiresTrailerCheckout,
      trip: refreshedTrip,
      job: refreshedJob,
    };
  }

  async getTripCompletionRequirements(
    tenantId: string,
    jobId: string,
    tripId: string,
    driverUserId: string,
  ) {
    await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId);
    const trip = await this.findPublishedTripOrThrow(tenantId, jobId, tripId);
    if (trip.assignedDriverUserId !== driverUserId) {
      throw new BadRequestException("You are not assigned to this trip");
    }

    const completionDocs = await this.prisma.tripDocument.findMany({
      where: {
        tenantId,
        tripId,
        isActive: true,
        type: {
          in: [
            TripDocumentType.DELIVERY_DO,
            TripDocumentType.POD_SIGNATURE,
            TripDocumentType.PICKUP_DO,
          ],
        },
      },
      select: { type: true, signedAt: true, isSigned: true },
    });
    const missingDocuments = this.buildTripCompletionDocumentGaps(completionDocs);

    const referenceDate = trip.plannedStartAt ?? trip.createdAt;
    const tenantTimeZone = await this.getTenantTimeZone(tenantId);
    const dayWindow = this.getTenantDayWindow(referenceDate, tenantTimeZone);
    const driverDayOpenTrips = await this.getDriverDayOpenTripsByWindow(
      tenantId,
      driverUserId,
      dayWindow,
    );
    const requiresTrailerCheckout = driverDayOpenTrips.length === 1;
    const missingTrailerCheckoutFields: string[] = [];
    if (requiresTrailerCheckout) {
      missingTrailerCheckoutFields.push("trailerEndPhoto", "trailerParkingLocationCode");
    }
    const parkingLocations = await this.prisma.masterTrailerLocation.findMany({
      orderBy: [{ code: "asc" }],
      select: { id: true, code: true, name: true },
    });

    return {
      canComplete: trip.status === TripStatus.ONGOING && missingDocuments.length === 0,
      missingDocuments,
      requiresTrailerCheckout,
      missingBaseCompletionDocuments: missingDocuments,
      missingTrailerCheckoutFields,
      trailerNumber: trip.trailerNumber ?? null,
      parkingLocations,
    };
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
            TripDocumentType.TRAILER_PARKING_PHOTO,
            TripDocumentType.TRAILER_START_PHOTO,
            TripDocumentType.TRAILER_END_PHOTO,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(docs.map((d) => this.attachTripDocumentSignedUrl(d)));
  }

  async getTripDetailForDriver(
    tenantId: string,
    tripId: string,
    driverUserId: string,
  ): Promise<any> {
    const trip = await this.prisma.trip.findFirst({
      where: {
        id: tripId,
        tenantId,
        status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] },
      },
      include: {
        job: {
          include: {
            customerCompany: { select: { name: true } },
            items: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                itemCode: true,
                description: true,
                qty: true,
              },
            },
          },
        },
        documents: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!trip || trip.assignedDriverUserId !== driverUserId) {
      throw new NotFoundException("Trip not found");
    }

    const trailerLocationName = trip.trailerLastLocationCode
      ? (await this.prisma.masterTrailerLocation.findFirst({
          where: { code: trip.trailerLastLocationCode },
          select: { name: true },
        }))?.name ?? null
      : null;

    const docsWithUrls = await Promise.all(
      (trip.documents ?? []).map((d) => this.attachTripDocumentSignedUrl(d)),
    );

    const trailerStartPhotoUrl = docsWithUrls.find(
      (d) => d.type === TripDocumentType.TRAILER_START_PHOTO,
    )?.url ?? null;
    const trailerEndPhotoUrl = docsWithUrls.find(
      (d) => d.type === TripDocumentType.TRAILER_END_PHOTO,
    )?.url ?? null;

    return {
      id: trip.id,
      jobId: trip.jobId,
      title: trip.title ?? trip.displayTitle ?? null,
      status: trip.status,
      plannedStartAt: trip.plannedStartAt ?? null,
      jobSequence: trip.jobSequence ?? null,
      tripSequence: trip.tripSequence ?? null,
      origin: trip.originLabel ?? null,
      destination: trip.destinationLabel ?? null,

      trailerNumber: trip.trailerNumber ?? null,
      trailerLastLocationCode: trip.trailerLastLocationCode ?? null,
      trailerLastLocationName: trailerLocationName,
      trailerParkedAt: trip.trailerParkedAt ?? null,
      trailerParkingLat: trip.trailerParkingLat ?? null,
      trailerParkingLng: trip.trailerParkingLng ?? null,
      trailerStartPhotoUrl,
      trailerEndPhotoUrl,

      job: trip.job
        ? {
            id: trip.job.id,
            internalRef: trip.job.internalRef ?? null,
            externalRef: trip.job.externalRef ?? null,
            jobType: trip.job.jobType ?? null,
            status: trip.job.status ?? null,
            customerName: trip.job.customerCompany?.name ?? null,
          }
        : null,

      documents: docsWithUrls.map((doc) => ({
        id: doc.id,
        type: doc.type,
        status: doc.signedAt ? "SIGNED" : "UPLOADED",
        label: doc.type,
        fileName: doc.fileName,
        originalFileName: doc.originalFileName ?? null,
        mimeType: doc.mimeType ?? null,
        fileSizeBytes: doc.fileSizeBytes ?? null,
        fileUrl: doc.url ?? null,
        uploadedAt: doc.createdAt,
        signedAt: doc.signedAt ?? null,
      })),

      cargo: {
        items: (trip.job?.items ?? []).map((item: any) => ({
          id: item.id,
          itemCode: item.itemCode ?? null,
          description: item.description ?? null,
          qty: item.qty ?? null,
        })),
      },
      route: {
        origin: {
          label: trip.originLabel ?? null,
          addressLine1: trip.originAddressLine1 ?? null,
          addressLine2: trip.originAddressLine2 ?? null,
          postalCode: trip.originPostalCode ?? null,
          country: trip.originCountry ?? null,
          lat: trip.originLat ?? null,
          lng: trip.originLng ?? null,
        },
        destination: {
          label: trip.destinationLabel ?? null,
          addressLine1: trip.destinationAddressLine1 ?? null,
          addressLine2: trip.destinationAddressLine2 ?? null,
          postalCode: trip.destinationPostalCode ?? null,
          country: trip.destinationCountry ?? null,
          lat: trip.destinationLat ?? null,
          lng: trip.destinationLng ?? null,
        },
        publishedAt: trip.publishedAt ?? null,
        startedAt: trip.startedAt ?? null,
        closedAt: trip.closedAt ?? null,
      },
    };
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
    if (!file?.buffer?.length) {
      throw new BadRequestException("Trip document file is required");
    }

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
    const normalizedSignedByName = signedByName?.trim() || null;
    const updated = await this.prisma.tripDocument.update({
      where: { id: documentId },
      data: {
        isSigned: true,
        signedAt: new Date(),
        signedByUserId: driverUserId,
        signedByName: normalizedSignedByName,
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
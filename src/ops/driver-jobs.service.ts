import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
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
const DRIVER_DELETABLE_TRIP_DOC_TYPES = new Set<TripDocumentType>([
  TripDocumentType.POD_PHOTO,
  TripDocumentType.OTHER,
]);

function normalizeText(value?: string | null): string | null {
  if (!value) return null;
  return value.replace(/\s+/g, " ").trim();
}

function firstNonEmptyText(...values: Array<unknown>): string | null {
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s.length > 0) return s;
  }
  return null;
}

/** Home / active list: trip-first row with job context and resolved route vs job addresses. */
function buildDriverTripExecutionCard(t: any, j: any) {
  const originSummary =
    firstNonEmptyText(
      t.originLabel,
      t.originAddressLine1,
      t.originAddressLine2,
      t.originPostalCode,
    ) ?? firstNonEmptyText(j.pickupAddress1, j.pickupAddress2, j.pickupPostal);

  const destinationSummary =
    firstNonEmptyText(
      t.destinationLabel,
      t.destinationAddressLine1,
      t.destinationAddressLine2,
      t.destinationPostalCode,
    ) ?? firstNonEmptyText(j.deliveryAddress1, j.deliveryAddress2, j.deliveryPostal);

  return {
    jobInternalRef: j.internalRef ?? null,
    customerName: j.customerCompany?.name ?? null,
    jobType: j.jobType,
    originSummary,
    destinationSummary,
    pickupAddress1:
      firstNonEmptyText(t.originAddressLine1, j.pickupAddress1) ?? j.pickupAddress1 ?? "",
    pickupAddress2:
      firstNonEmptyText(t.originAddressLine2, j.pickupAddress2) ?? j.pickupAddress2 ?? null,
    pickupPostal:
      firstNonEmptyText(t.originPostalCode, j.pickupPostal) ?? j.pickupPostal ?? null,
    deliveryAddress1:
      firstNonEmptyText(t.destinationAddressLine1, j.deliveryAddress1) ?? j.deliveryAddress1 ?? "",
    deliveryAddress2:
      firstNonEmptyText(t.destinationAddressLine2, j.deliveryAddress2) ?? j.deliveryAddress2 ?? null,
    deliveryPostal:
      firstNonEmptyText(t.destinationPostalCode, j.deliveryPostal) ?? j.deliveryPostal ?? null,
    notes: j.notes ?? null,
  };
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
        jobId: t.jobId ?? j.id,
        jobSequence: t.jobSequence ?? null,
        tripSequence: t.tripSequence ?? t.jobSequence ?? null,
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
        ...buildDriverTripExecutionCard(t, j),
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

  private parseCalendarDateToUtcRangeInTimeZone(
    dateStr: string,
    timeZone: string,
  ): { gte: Date; lt: Date } {
    const m = String(dateStr ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) throw new BadRequestException("date must be YYYY-MM-DD");
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!mo || mo < 1 || mo > 12 || !d || d < 1 || d > 31) {
      throw new BadRequestException("date must be YYYY-MM-DD");
    }
    const gte = this.zonedDateTimeToUtc(y, mo, d, 0, 0, 0, timeZone);
    const lt = this.zonedDateTimeToUtc(y, mo, d + 1, 0, 0, 0, timeZone);
    return { gte, lt };
  }

  private getDateKeyInTimeZone(value: Date, timeZone: string): string {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = dtf.formatToParts(value);
    const map = new Map(parts.map((p) => [p.type, p.value] as const));
    return `${map.get("year")}-${map.get("month")}-${map.get("day")}`;
  }

  private async buildDriverDailyRunSheet(
    tenantId: string,
    driverUserId: string,
    requestedDate?: string,
  ): Promise<any | null> {
    // Keep backwards compatibility for legacy unit mocks that do not define trip/user delegates.
    if (!this.prisma?.trip?.findMany || !this.prisma?.user?.findUnique) return null;

    const tz = await this.getTenantTimeZone(tenantId);
    const dayWindow = requestedDate
      ? this.parseCalendarDateToUtcRangeInTimeZone(requestedDate, tz)
      : this.getTenantDayWindow(new Date(), tz);

    const runDate = requestedDate || this.getDateKeyInTimeZone(dayWindow.gte, tz);

    const [driverUser, trips] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: driverUserId },
        select: { id: true, name: true },
      }),
      this.prisma.trip.findMany({
        where: {
          tenantId,
          assignedDriverUserId: driverUserId,
          status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] },
          OR: [
            { plannedStartAt: { gte: dayWindow.gte, lt: dayWindow.lt } },
            { plannedStartAt: null, createdAt: { gte: dayWindow.gte, lt: dayWindow.lt } },
          ],
        },
        include: {
          job: {
            select: {
              id: true,
              internalRef: true,
              jobType: true,
              notes: true,
              pickupAddress1: true,
              pickupAddress2: true,
              pickupPostal: true,
              deliveryAddress1: true,
              deliveryAddress2: true,
              deliveryPostal: true,
              customerCompany: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    const sorted = [...(trips ?? [])].sort((a: any, b: any) => {
      const aSeq = a.tripSequence ?? a.jobSequence ?? null;
      const bSeq = b.tripSequence ?? b.jobSequence ?? null;
      if (aSeq != null && bSeq != null && aSeq !== bSeq) return aSeq - bSeq;
      if (aSeq != null && bSeq == null) return -1;
      if (aSeq == null && bSeq != null) return 1;
      const aStart = a.plannedStartAt ? new Date(a.plannedStartAt).getTime() : Number.POSITIVE_INFINITY;
      const bStart = b.plannedStartAt ? new Date(b.plannedStartAt).getTime() : Number.POSITIVE_INFINITY;
      if (aStart !== bStart) return aStart - bStart;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const isCompleted = (s: TripStatus) => s === TripStatus.COMPLETED || s === TripStatus.DONE;
    const current = sorted.find((t: any) => t.status === TripStatus.ONGOING) ?? null;
    const sequentialEnforced = sorted.some((t: any) => (t.tripSequence ?? t.jobSequence) != null);

    let nextTripId: string | null = current?.id ?? null;
    if (!nextTripId) {
      for (let i = 0; i < sorted.length; i += 1) {
        const t = sorted[i];
        if (t.status !== TripStatus.PUBLISHED) continue;
        const prevIncomplete = sorted.slice(0, i).some((p: any) => !isCompleted(p.status));
        if (!prevIncomplete) {
          nextTripId = t.id;
          break;
        }
      }
    }

    const items = sorted.map((t: any, idx: number) => {
      const sequence = t.tripSequence ?? t.jobSequence ?? null;
      const prevIncomplete = sorted.slice(0, idx).some((p: any) => !isCompleted(p.status));
      const isLockedBySequence =
        !!sequentialEnforced && t.status === TripStatus.PUBLISHED && prevIncomplete;
      const isCurrent = current?.id === t.id;
      const canContinue = t.status === TripStatus.ONGOING;
      const canComplete = t.status === TripStatus.ONGOING;
      const canStart =
        !current
        && t.status === TripStatus.PUBLISHED
        && !isLockedBySequence;

      const originSummary =
        firstNonEmptyText(
          t.originLabel,
          t.originAddressLine1,
          t.originAddressLine2,
          t.originPostalCode,
        ) ?? firstNonEmptyText(t.job?.pickupAddress1, t.job?.pickupAddress2, t.job?.pickupPostal);
      const destinationSummary =
        firstNonEmptyText(
          t.destinationLabel,
          t.destinationAddressLine1,
          t.destinationAddressLine2,
          t.destinationPostalCode,
        ) ?? firstNonEmptyText(t.job?.deliveryAddress1, t.job?.deliveryAddress2, t.job?.deliveryPostal);

      return {
        tripId: t.id,
        jobId: t.jobId ?? null,
        jobInternalRef: t.job?.internalRef ?? null,
        customerName: t.job?.customerCompany?.name ?? null,
        sequence,
        title: t.title ?? t.displayTitle ?? null,
        status: t.status,
        pendingState: t.pendingState ?? TripPendingState.NONE,
        originSummary,
        destinationSummary,
        plannedStartAt: t.plannedStartAt ?? null,
        startedAt: t.startedAt ?? null,
        closedAt: t.closedAt ?? null,
        completedAt: t.closedAt ?? (isCompleted(t.status) ? (t.updatedAt ?? null) : null),
        trailerNumber: t.trailerNumber ?? null,
        canStart,
        canContinue,
        canComplete,
        isCurrent,
        isNextActionable: nextTripId === t.id && !isCurrent,
        isLockedBySequence,
        routeVersion: t.routeVersion ?? null,
      };
    });

    return {
      runDate,
      driverId: driverUserId,
      driverName: driverUser?.name ?? null,
      totalTrips: sorted.length,
      completedTrips: sorted.filter((t: any) => isCompleted(t.status)).length,
      ongoingTrips: sorted.filter((t: any) => t.status === TripStatus.ONGOING).length,
      nextTripId,
      currentTripId: current?.id ?? null,
      routeVersion: sorted.find((t: any) => t.routeVersion != null)?.routeVersion ?? null,
      routeOptimisedAt: null,
      routeOptimisedByUserId: null,
      routeOptimisedByName: null,
      trips: items,
    };
  }

  /** Inclusive-exclusive UTC range for a calendar month in a tenant IANA time zone. */
  private parseCalendarMonthToUtcRangeInTimeZone(
    monthStr: string,
    timeZone: string,
  ): { gte: Date; lt: Date } {
    const m = monthStr.trim().match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new BadRequestException("month must be YYYY-MM");
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (!mo || mo < 1 || mo > 12) {
      throw new BadRequestException("month must be YYYY-MM");
    }
    const gte = this.zonedDateTimeToUtc(y, mo, 1, 0, 0, 0, timeZone);
    let ny = y;
    let nm = mo + 1;
    if (nm === 13) {
      nm = 1;
      ny += 1;
    }
    const lt = this.zonedDateTimeToUtc(ny, nm, 1, 0, 0, 0, timeZone);
    return { gte, lt };
  }

  /** Inclusive-exclusive UTC range for a calendar year in a tenant IANA time zone. */
  private parseCalendarYearToUtcRangeInTimeZone(
    year: number,
    timeZone: string,
  ): { gte: Date; lt: Date } {
    const gte = this.zonedDateTimeToUtc(year, 1, 1, 0, 0, 0, timeZone);
    const lt = this.zonedDateTimeToUtc(year + 1, 1, 1, 0, 0, 0, timeZone);
    return { gte, lt };
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
      uploadedByName: doc.uploadedByName ?? doc.uploadedByNameSnapshot ?? null,
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
  ): Promise<{ data: JobDto[]; meta: { page: number; pageSize: number; total: number }; runSheet?: any | null }> {
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

    const runSheet = await this.buildDriverDailyRunSheet(tenantId, driverUserId, query?.date);

    return {
      data,
      meta: buildPaginationMeta(page, pageSize, total),
      runSheet,
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
    const tz = await this.getTenantTimeZone(tenantId);

    const month = query?.month?.trim();
    const yearStr = query?.year?.trim();

    const now = new Date();
    const defaultYear =
      Number(
        new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" })
          .formatToParts(now)
          .find((p) => p.type === "year")?.value,
      ) || now.getUTCFullYear();

    let range: { gte: Date; lt: Date };
    if (month) {
      range = this.parseCalendarMonthToUtcRangeInTimeZone(month, tz);
    } else {
      const year = yearStr ? Number(yearStr) : defaultYear;
      if (!year || Number.isNaN(year)) {
        throw new BadRequestException("year must be YYYY");
      }
      range = this.parseCalendarYearToUtcRangeInTimeZone(year, tz);
    }

    const countRows = (await this.prisma.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::bigint AS c
      FROM trips t
      WHERE
        t."tenantId" = ${tenantId}
        AND t."assignedDriverUserId" = ${driverUserId}
        AND t.status::text IN ('COMPLETED', 'DONE')
        AND (
          (t."closedAt" IS NOT NULL AND t."closedAt" >= ${range.gte} AND t."closedAt" < ${range.lt})
          OR (t."closedAt" IS NULL AND t."updatedAt" >= ${range.gte} AND t."updatedAt" < ${range.lt})
        )
    `)) as Array<{ c: bigint }>;
    const countRow = countRows[0];
    const total = Number(countRow?.c ?? 0);

    const idRows = (await this.prisma.$queryRaw(Prisma.sql`
      SELECT t.id
      FROM trips t
      WHERE
        t."tenantId" = ${tenantId}
        AND t."assignedDriverUserId" = ${driverUserId}
        AND t.status::text IN ('COMPLETED', 'DONE')
        AND (
          (t."closedAt" IS NOT NULL AND t."closedAt" >= ${range.gte} AND t."closedAt" < ${range.lt})
          OR (t."closedAt" IS NULL AND t."updatedAt" >= ${range.gte} AND t."updatedAt" < ${range.lt})
        )
      ORDER BY COALESCE(t."closedAt", t."updatedAt") DESC
      OFFSET ${skip} LIMIT ${take}
    `)) as Array<{ id: string }>;

    if (!idRows.length) {
      return {
        data: [],
        meta: buildPaginationMeta(page, pageSize, total),
      };
    }

    const tripsHydrated = await this.prisma.trip.findMany({
      where: { id: { in: idRows.map((r) => r.id) } },
      include: {
        job: {
          include: {
            customerCompany: { select: { id: true, name: true } },
            assignedDriver: { select: { id: true, name: true } },
            items: { orderBy: { createdAt: "asc" } },
            documents: {
              where: { isActive: true, type: { in: ["QUOTATION", "OTHER"] } },
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });

    const orderIdx = new Map<string, number>(idRows.map((r, i) => [r.id, i]));
    tripsHydrated.sort(
      (a, b) => Number(orderIdx.get(a.id) ?? 0) - Number(orderIdx.get(b.id) ?? 0),
    );

    const vehicleIds = [
      ...new Set(tripsHydrated.map((t) => t.vehicleId).filter(Boolean)),
    ] as string[];
    const fleetVehicleIds = [
      ...new Set(tripsHydrated.map((t) => t.fleetVehicleId).filter(Boolean)),
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

    type Group = { job: any; trips: any[] };
    const groups: Group[] = [];
    const idxByJob = new Map<string, number>();

    for (const t of tripsHydrated) {
      const job = t.job;
      if (!job) continue;
      const jid = job.id;
      let ix = idxByJob.get(jid);
      if (ix === undefined) {
        groups.push({ job, trips: [] });
        ix = groups.length - 1;
        idxByJob.set(jid, ix);
      }
      groups[ix].trips.push(t);
    }

    const data = await Promise.all(
      groups.map(async ({ job, trips: tripsForJob }) => {
        const primaryTrip = tripsForJob[0];
        const dto = toJobDto({
          ...job,
          trips: tripsForJob,
          assignedVehiclePlateNo:
            (primaryTrip?.vehicleId && vehicleMap.get(primaryTrip.vehicleId)) ||
            (primaryTrip?.fleetVehicleId && vehicleMap.get(primaryTrip.fleetVehicleId)) ||
            null,
        });

        return {
          ...dto,
          documents: await Promise.all(
            (job.documents ?? []).map((doc: any) => this.attachSignedUrl(doc)),
          ),
        };
      }),
    );

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
    const tz = await this.getTenantTimeZone(tenantId);
    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        assignedDriverUserId: driverUserId,
        status: { in: [TripStatus.COMPLETED, TripStatus.DONE] },
      },
      select: {
        closedAt: true,
        updatedAt: true,
      },
    });

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

    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
    });

    type MonthAgg = { monthKey: string; monthNum: number; total: number; year: number };
    const byYear = new Map<number, { year: number; total: number; months: Map<string, MonthAgg> }>();

    for (const t of trips) {
      const effective = t.closedAt ?? t.updatedAt;
      if (!effective) continue;

      const parts = dtf.formatToParts(effective);
      const year = Number(parts.find((p) => p.type === "year")?.value ?? NaN);
      const monthNum = Number(parts.find((p) => p.type === "month")?.value ?? NaN);
      if (!Number.isFinite(year) || !Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) {
        continue;
      }

      const monthKey = `${year}-${String(monthNum).padStart(2, "0")}`;
      let yEntry = byYear.get(year);
      if (!yEntry) {
        yEntry = { year, total: 0, months: new Map() };
        byYear.set(year, yEntry);
      }
      yEntry.total += 1;

      const existing = yEntry.months.get(monthKey);
      if (existing) {
        existing.total += 1;
      } else {
        yEntry.months.set(monthKey, {
          monthKey,
          monthNum,
          total: 1,
          year,
        });
      }
    }

    const years = Array.from(byYear.values())
      .sort((a, b) => b.year - a.year)
      .map((y) => ({
        year: y.year,
        total: y.total,
        months: Array.from(y.months.values())
          .sort((a, b) => b.monthNum - a.monthNum)
          .map((m) => ({
            month: m.monthKey,
            label: `${monthNames[m.monthNum - 1] ?? `Month ${m.monthNum}`} ${m.year}`,
            total: m.total,
          })),
      }));

    return { years };
  }

  async getWalletSummaryByMonth(
    tenantId: string,
    driverUserId: string,
    month: string,
  ): Promise<{
    month: string;
    totalCents: number;
    completedTripCount: number;
    trips: Array<{
      tripId: string;
      jobId: string | null;
      jobInternalRef: string | null;
      title: string | null;
      completedAt: Date | null;
      driverEarningCents: number;
      earningLabelSnapshot: string | null;
      status: TripStatus;
    }>;
  }> {
    const monthKey = String(month ?? "").trim();
    if (!monthKey) {
      throw new BadRequestException("month must be YYYY-MM");
    }
    const tz = await this.getTenantTimeZone(tenantId);
    const range = this.parseCalendarMonthToUtcRangeInTimeZone(monthKey, tz);
    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        assignedDriverUserId: driverUserId,
        status: { in: [TripStatus.COMPLETED, TripStatus.DONE] },
        OR: [
          { closedAt: { gte: range.gte, lt: range.lt } },
          { closedAt: null, updatedAt: { gte: range.gte, lt: range.lt } },
        ],
      },
      orderBy: [{ closedAt: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        jobId: true,
        title: true,
        status: true,
        closedAt: true,
        updatedAt: true,
        driverEarningCents: true,
        earningLabelSnapshot: true,
        payoutLines: {
          select: { totalCents: true },
        },
        job: {
          select: {
            internalRef: true,
          },
        },
      },
    });

    const tripRows = trips.map((trip) => {
      const payoutTotal = (trip.payoutLines ?? []).reduce(
        (sum, line) => sum + (line.totalCents ?? 0),
        0,
      );
      const earning = trip.driverEarningCents ?? payoutTotal;
      return {
        tripId: trip.id,
        jobId: trip.jobId ?? null,
        jobInternalRef: trip.job?.internalRef ?? null,
        title: trip.title ?? null,
        completedAt: trip.closedAt ?? trip.updatedAt ?? null,
        driverEarningCents: earning,
        earningLabelSnapshot: trip.earningLabelSnapshot ?? null,
        status: trip.status,
      };
    });
    const totalCents = tripRows.reduce((sum, row) => sum + (row.driverEarningCents ?? 0), 0);

    return {
      month: monthKey,
      totalCents,
      completedTripCount: tripRows.length,
      trips: tripRows,
    };
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
        uploadedByUserId: doc.uploadedByUserId ?? null,
        uploadedByName: doc.uploadedByName ?? null,
        uploadedByCurrentDriver: doc.uploadedByUserId === driverUserId,
        canDelete:
          doc.isActive === true
          && doc.uploadedByUserId === driverUserId
          && DRIVER_DELETABLE_TRIP_DOC_TYPES.has(doc.type as TripDocumentType),
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

  async deleteTripDocumentForDriver(
    tenantId: string,
    jobId: string,
    tripId: string,
    documentId: string,
    driverUserId: string,
  ): Promise<{ success: true; documentId: string }> {
    await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId);
    const trip = await this.findPublishedTripOrThrow(tenantId, jobId, tripId);
    if (
      trip.status === TripStatus.COMPLETED
      || trip.status === TripStatus.DONE
      || trip.status === TripStatus.CANCELLED
    ) {
      throw new BadRequestException(
        "Trip documents cannot be deleted after trip completion/cancellation",
      );
    }

    const doc = await this.prisma.tripDocument.findFirst({
      where: {
        id: documentId,
        tenantId,
        tripId,
        isActive: true,
      },
    });

    if (!doc) {
      throw new NotFoundException("Trip document not found");
    }

    if (!DRIVER_DELETABLE_TRIP_DOC_TYPES.has(doc.type)) {
      throw new BadRequestException("Unsupported trip document type for driver delete");
    }

    if (doc.uploadedByUserId !== driverUserId) {
      throw new ForbiddenException("You can only delete your own trip documents");
    }

    await this.prisma.tripDocument.update({
      where: { id: doc.id },
      data: { isActive: false },
    });

    await this.audit.log(
      tenantId,
      "TRIP_DOC_DELETE",
      "TRIP",
      tripId,
      { jobId, documentId: doc.id, type: doc.type },
      driverUserId,
    );

    return { success: true, documentId: doc.id };
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
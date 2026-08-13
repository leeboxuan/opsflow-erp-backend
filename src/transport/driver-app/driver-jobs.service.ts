import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Optional,
} from "@nestjs/common";
import {
  JobStatus,
  JobType,
  Prisma,
  Role,
  TripPendingState,
  TripStatus,
  TripDocumentType,
} from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { parsePaginationFromQuery, buildPaginationMeta } from "../../shared/common/pagination";
import { buildOrderBy } from "../../shared/common/listing/listing.sort";
import { AuditService } from "../../shared/audit/audit.service";
import { SupabaseService } from "../../shared/auth/supabase.service";
import { buildDocumentFileDisplayFields } from "../documents/document-file-display";
import {
  buildDocumentSignedUrlResponse,
  JOB_DOCUMENTS_BUCKET,
} from "../documents/job-document-signed-url";
import {
  documentUploadedByInclude,
  loadUploadActorFields,
  resolveDocumentUploadedByFields,
} from "../documents/document-uploader.utils";
import { buildTripDisplayRef } from "../trips/trip-display-ref";
import { CANONICAL_TRIP_PAYOUT_LINE_SELECT } from "../trips/trip-payout.helpers";
import {
  createDriverTripDocUploadPerfTimer,
  withDriverEndpointPerf,
} from "./driver-endpoint-perf";
import { JobLocationDto } from "./dto/location.dto";
import { DocumentSignedUrlDto, JobDto, JobDocumentDto } from "../jobs/dto/job.dto";
import {
  buildTripCompletionDocumentGaps,
  trailerCheckoutBlocksCompletion,
  resolveTripRouteAddressResponseFields,
  isContainerCargoJobType,
  jobTripTemplateDisplayLabel,
} from "../workflows/job-workflow.helpers";
import {
  buildTripCargoFromLinks,
  isContainerBasedTransportJob,
} from "../jobs/trip-job-item.helpers";
import {
  assertJobItemLinkedToTrip,
  loadTripJobItemLinks,
} from "../jobs/trip-job-item.mutations";
import {
  resolveJobDescription,
  resolveJobPickupReference,
  normalizeOptionalTrimmedText,
  resolveSealNoFromItemInput,
} from "../jobs/job-field-resolution.helpers";
import {
  compareTripsByEffectiveSchedule,
  evaluateTripStartDateGate,
  tripStartDateGateErrorMessage,
} from "./driver-trip-schedule.helpers";
import {
  buildContainerDocumentationRequirements,
  containerDocumentationErrorLabels,
  getMissingContainerDocumentTypes,
  type ContainerDocumentationRequirement,
} from "./container-documentation.helpers";
import { UpdateDriverOperationalDetailsDto } from "./dto/update-driver-operational-details.dto";
import {
  evaluateJobInvoiceReadiness,
  syncJobInvoiceReadiness,
  type JobInvoiceSyncPrisma,
} from "../jobs/job-invoice-readiness";
import { RealtimeEventsService } from "../../shared/realtime/realtime-events.service";
import * as rt from "../../shared/realtime/realtime-publish";
import { TransportJobsService } from "../jobs/transport-jobs.service";
import { resolveTripNotesResponseFields } from "../trips/trip-notes.helpers";
import {
  DO_SIGN_REQUIRES_ONGOING_TRIP_MESSAGE,
  isSignableDoType,
  parseSignatureContentType,
  parseSignatureImageBytes,
  parseSignedAtFromBody,
  tripStatusAllowsDoSign,
  type SignTripDocumentBody,
} from "../documents/do-signature.helpers";
import { DRIVER_ACTIVE_JOB_DOCUMENTS_INCLUDE } from "../documents/driver-mobile-document.select";
import { DriverTripEarningsService } from "../drivers/driver-trip-earnings.service";
import {
  DEFAULT_DRIVER_EARNING_CURRENCY,
  DEFAULT_TENANT_TIMEZONE,
  getSafeTenantTimezone,
  parseCalendarMonthToUtcRangeInTimeZone,
  resolveDriverTripEarningCents,
  zonedDateTimeToUtc,
} from "../drivers/driver-trip-earnings.helpers";

const TENANT_TIMEZONE_CACHE_TTL_MS = 5 * 60 * 1000;
const DRIVER_NON_DELETABLE_TRIP_DOC_TYPES = new Set<TripDocumentType>([
  TripDocumentType.TRAILER_START_PHOTO,
  TripDocumentType.TRAILER_END_PHOTO,
]);

/** Trip document types drivers may upload via POST .../trips/:tripId/documents */
export const DRIVER_UPLOADABLE_TRIP_DOCUMENT_TYPES = [
  TripDocumentType.PICKUP_DO,
  TripDocumentType.DELIVERY_DO,
  TripDocumentType.POD_PHOTO,
  TripDocumentType.POD_SIGNATURE,
  TripDocumentType.OTHER,
  TripDocumentType.CONTAINER_PHOTO,
  TripDocumentType.SEAL_PHOTO,
  TripDocumentType.TRAILER_START_PHOTO,
  TripDocumentType.TRAILER_END_PHOTO,
] as const;

const DRIVER_UPLOADABLE_TRIP_DOCUMENT_TYPE_SET = new Set<TripDocumentType>(
  DRIVER_UPLOADABLE_TRIP_DOCUMENT_TYPES,
);

const DRIVER_SINGLE_ACTIVE_TRIP_DOCUMENT_TYPES = new Set<TripDocumentType>([
  TripDocumentType.PICKUP_DO,
  TripDocumentType.DELIVERY_DO,
  TripDocumentType.POD_SIGNATURE,
  TripDocumentType.CONTAINER_PHOTO,
  TripDocumentType.SEAL_PHOTO,
  TripDocumentType.TRAILER_START_PHOTO,
  TripDocumentType.TRAILER_END_PHOTO,
]);
const DRIVER_NON_DELETABLE_TRIP_STATUSES = new Set<TripStatus>([
  TripStatus.COMPLETED,
  TripStatus.DONE,
  TripStatus.CANCELLED,
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
    collectionType: j.collectionType ?? null,
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
    ...resolveTripNotesResponseFields(t, j),
    ...resolveTripRouteAddressResponseFields(t),
  };
}

function toDocDto(d: any): JobDocumentDto {
  const isPodSignature = d.type === TripDocumentType.POD_SIGNATURE;
  const uploader = resolveDocumentUploadedByFields(d);
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
    uploadedByUserId: uploader.uploadedByUserId,
    uploadedByName: uploader.uploadedByName,
    uploadedByEmail: uploader.uploadedByEmail,
    uploadedAt: uploader.uploadedAt,
    generatedBySystem: d.generatedBySystem ?? false,
    generatedSource: d.generatedSource ?? null,
    jobId: d.jobId ?? null,
    tripId: d.tripId ?? null,
    jobItemId: d.jobItemId ?? null,
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

  const computedReadiness = trips.length > 0
    ? evaluateJobInvoiceReadiness(
      trips
        .filter((trip: any) => trip?.id && trip?.status)
        .map((trip: any) => ({ id: trip.id as string, status: trip.status as TripStatus })),
    )
    : null;

  return {
    id: j.id,
    tenantId: j.tenantId,
    customerCompanyId: j.customerCompanyId,
    companyName: j.customerCompany?.name ?? null,

    internalRef: j.internalRef,
    externalRef: j.externalRef ?? null,
    jobType: j.jobType,
    collectionType: j.collectionType ?? null,
    status: j.status,
    invoiceReadyAt: j.invoiceReadyAt ?? null,
    isInvoiceReady: j.status === JobStatus.READY_FOR_INVOICE,
    computedInvoiceReady:
      computedReadiness?.readyForInvoice ??
      (j.status === JobStatus.READY_FOR_INVOICE ? true : trips.length > 0 ? false : undefined),
    computedInvoiceReadinessReason: computedReadiness?.reason ?? null,
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
        tripDisplayRef: buildTripDisplayRef({
          jobInternalRef: j.internalRef ?? null,
          tripSequence: t.tripSequence ?? null,
          jobSequence: t.jobSequence ?? null,
          tripId: t.id,
        }),
        jobTripTemplate: t.jobTripTemplate ?? null,
        title: t.title ?? null,
        tripPICName: t.tripPICName ?? null,
        tripPICContact: t.tripPICContact ?? null,
        containerNumber: t.containerNumber ?? null,
        carrier: t.carrier ?? null,
        shipper: t.shipper ?? null,
        vessel: t.vessel ?? null,
        status: t.status,
        assignedDriverUserId: t.assignedDriverUserId ?? null,
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
        driverEarningCents: resolveDriverTripEarningCents(t),
        hasDriverPayout: resolveDriverTripEarningCents(t) != null,
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

/** Trailer parking codes for completion UI (rarely changes). */
const TRAILER_PARKING_LOCATIONS_CACHE_TTL_MS = 5 * 60 * 1000;
let trailerParkingLocationsCache:
  | { expiresAt: number; rows: Array<{ id: string; code: string; name: string }> }
  | null = null;

@Injectable()
export class DriverJobsService {
  private readonly tenantTimezoneCache = new Map<string, { timezone: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly supabaseService: SupabaseService,
    @Optional() private readonly opsJobs?: TransportJobsService,
    @Optional() private readonly realtime?: RealtimeEventsService,
    @Optional() private readonly tripEarnings?: DriverTripEarningsService,
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

  private static readonly COMPLETION_DOC_QUERY_TYPES: TripDocumentType[] = [
    TripDocumentType.DELIVERY_DO,
    TripDocumentType.POD_SIGNATURE,
    TripDocumentType.PICKUP_DO,
    TripDocumentType.POD_PHOTO,
    TripDocumentType.OTHER,
    TripDocumentType.CONTAINER_PHOTO,
    TripDocumentType.SEAL_PHOTO,
  ];

  private buildMissingTrailerCheckoutFields(
    requiresTrailerCheckout: boolean,
    input: {
      hasTrailerEndPhoto: boolean;
      trailerParkingLocationCode?: string | null;
    },
  ): string[] {
    if (!requiresTrailerCheckout) return [];
    const missing: string[] = [];
    if (!input.hasTrailerEndPhoto) {
      missing.push("trailerEndPhoto");
    }
    if (!String(input.trailerParkingLocationCode ?? "").trim()) {
      missing.push("trailerParkingLocationCode");
    }
    return missing;
  }

  private resolveTripCanComplete(
    tripStatus: TripStatus,
    missingBaseCompletionDocuments: string[],
    requiresTrailerCheckout: boolean,
    missingTrailerCheckoutFields: string[],
  ): boolean {
    if (tripStatus !== TripStatus.ONGOING) return false;
    const hasMissingBaseDocuments = missingBaseCompletionDocuments.length > 0;
    const hasMissingTrailerCheckout = trailerCheckoutBlocksCompletion(
      requiresTrailerCheckout,
      missingTrailerCheckoutFields,
    );
    return !hasMissingBaseDocuments && !hasMissingTrailerCheckout;
  }

  private async driverTripHasActiveTrailerEndPhoto(
    tenantId: string,
    tripId: string,
  ): Promise<boolean> {
    const doc = await this.prisma.tripDocument.findFirst({
      where: {
        tenantId,
        tripId,
        isActive: true,
        type: TripDocumentType.TRAILER_END_PHOTO,
      },
      select: { id: true },
    });
    return !!doc;
  }

  private async computeTrailerCheckoutGapsForTrip(
    tenantId: string,
    driverUserId: string,
    trip: {
      id: string;
      plannedStartAt: Date | null;
      createdAt: Date;
      trailerLastLocationCode?: string | null;
    },
    opts?: {
      trailerParkingLocationCode?: string | null;
      hasNewTrailerEndPhotoUpload?: boolean;
    },
  ): Promise<{
    requiresTrailerCheckout: boolean;
    missingTrailerCheckoutFields: string[];
    resolvedTrailerParkingLocationCode: string | null;
    hasTrailerEndPhoto: boolean;
  }> {
    const tenantTimeZone = await this.getTenantTimeZone(tenantId);
    const referenceDate = trip.plannedStartAt ?? trip.createdAt;
    const dayWindow = this.getTenantDayWindow(referenceDate, tenantTimeZone);
    const driverDayOpenTrips = await this.getDriverDayOpenTripsByWindow(
      tenantId,
      driverUserId,
      dayWindow,
    );
    const requiresTrailerCheckout = driverDayOpenTrips.length === 1;

    const hasExistingTrailerEndPhoto = await this.driverTripHasActiveTrailerEndPhoto(
      tenantId,
      trip.id,
    );
    const hasTrailerEndPhoto =
      !!opts?.hasNewTrailerEndPhotoUpload || hasExistingTrailerEndPhoto;

    const resolvedTrailerParkingLocationCode =
      String(opts?.trailerParkingLocationCode ?? "").trim() ||
      String(trip.trailerLastLocationCode ?? "").trim() ||
      null;

    const missingTrailerCheckoutFields = this.buildMissingTrailerCheckoutFields(
      requiresTrailerCheckout,
      {
        hasTrailerEndPhoto,
        trailerParkingLocationCode: resolvedTrailerParkingLocationCode,
      },
    );

    return {
      requiresTrailerCheckout,
      missingTrailerCheckoutFields,
      resolvedTrailerParkingLocationCode,
      hasTrailerEndPhoto,
    };
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
          payoutLines: {
            select: CANONICAL_TRIP_PAYOUT_LINE_SELECT,
          },
          job: {
            select: {
              id: true,
              internalRef: true,
              jobType: true,
              notes: true,
              pickupDate: true,
              pickupReference: true,
              description: true,
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

    const sorted = [...(trips ?? [])].sort((a: any, b: any) =>
      compareTripsByEffectiveSchedule(
        {
          id: a.id,
          plannedStartAt: a.plannedStartAt,
          jobPickupDate: a.job?.pickupDate,
          tripSequence: a.tripSequence,
          jobSequence: a.jobSequence,
          createdAt: a.createdAt,
        },
        {
          id: b.id,
          plannedStartAt: b.plannedStartAt,
          jobPickupDate: b.job?.pickupDate,
          tripSequence: b.tripSequence,
          jobSequence: b.jobSequence,
          createdAt: b.createdAt,
        },
      ),
    );

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
        tripDisplayRef: buildTripDisplayRef({
          jobInternalRef: t.job?.internalRef ?? null,
          tripSequence: t.tripSequence ?? null,
          jobSequence: t.jobSequence ?? null,
          tripId: t.id,
        }),
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
        containerNumber: t.containerNumber ?? null,
        carrier: t.carrier ?? null,
        shipper: t.shipper ?? null,
        vessel: t.vessel ?? null,
        pickupDate: t.job?.pickupDate ?? null,
        pickupReference: t.job?.pickupReference ?? null,
        driverRemarks: t.driverRemarks ?? null,
        canStart,
        canContinue,
        canComplete,
        isCurrent,
        isNextActionable: nextTripId === t.id && !isCurrent,
        isLockedBySequence,
        routeVersion: t.routeVersion ?? null,
        driverEarningCents: resolveDriverTripEarningCents(t),
        driverEarningCurrency: DEFAULT_DRIVER_EARNING_CURRENCY,
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
    return parseCalendarMonthToUtcRangeInTimeZone(monthStr, timeZone);
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
    return getSafeTenantTimezone(value);
  }

  private isPrismaPoolTimeout(error: unknown): boolean {
    const maybe = error as { code?: string } | null;
    return String(maybe?.code ?? "") === "P2024";
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
    return zonedDateTimeToUtc(year, month, day, hour, minute, second, timeZone);
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
    const now = Date.now();
    const cached = this.tenantTimezoneCache.get(tenantId);
    if (cached && cached.expiresAt > now) {
      return cached.timezone;
    }
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { timezone: true },
      });
      const timezone = this.getSafeTenantTimezone(tenant?.timezone);
      this.tenantTimezoneCache.set(tenantId, {
        timezone,
        expiresAt: now + TENANT_TIMEZONE_CACHE_TTL_MS,
      });
      return timezone;
    } catch (error: unknown) {
      if (this.isPrismaPoolTimeout(error)) {
        const fallbackTimezone = cached?.timezone ?? DEFAULT_TENANT_TIMEZONE;
        console.warn("[DriverJobsService] tenant timezone lookup timeout; using fallback", {
          tenantId,
          fallbackTimezone,
          prismaCode: "P2024",
        });
        this.tenantTimezoneCache.set(tenantId, {
          timezone: fallbackTimezone,
          expiresAt: now + TENANT_TIMEZONE_CACHE_TTL_MS,
        });
        return fallbackTimezone;
      }
      throw error;
    }
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

  private toDocumentMetadataDto(doc: any): JobDocumentDto {
    const base = toDocDto(doc);
    return {
      ...base,
      url: null,
      downloadUrl: null,
      previewUrl: null,
    };
  }

  private async attachSignedUrl(doc: any): Promise<JobDocumentDto> {
    const base = toDocDto(doc);
    const signed = await buildDocumentSignedUrlResponse(
      this.supabaseService.getClient(),
      doc.storageKey,
      doc.tenantId,
    );
    return {
      ...base,
      url: signed.previewUrl,
      downloadUrl: signed.downloadUrl,
      previewUrl: signed.previewUrl,
    };
  }

  private attachTripDocumentMetadata(doc: any): JobDocumentDto {
    return this.toDocumentMetadataDto(doc);
  }

  private async attachTripDocumentSignedUrl(doc: any): Promise<JobDocumentDto> {
    return this.attachSignedUrl(doc);
  }

  async getDriverTripDocumentSignedUrl(
    tenantId: string,
    tripId: string,
    documentId: string,
    driverUserId: string,
  ): Promise<DocumentSignedUrlDto> {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId },
      select: { id: true, jobId: true, assignedDriverUserId: true },
    });
    if (!trip || trip.assignedDriverUserId !== driverUserId) {
      throw new NotFoundException("Trip not found");
    }

    const doc = await this.prisma.tripDocument.findFirst({
      where: { id: documentId, tenantId, tripId, isActive: true },
    });
    if (!doc) throw new NotFoundException("Document not found");

    if (isSignableDoType(doc.type)) {
      await this.opsJobs?.refreshSignedDoPdf(
        tenantId,
        trip.jobId,
        tripId,
        doc.type,
      );
      const refreshed = await this.prisma.tripDocument.findFirst({
        where: { id: documentId, tenantId, tripId, isActive: true },
      });
      if (refreshed?.storageKey) {
        return buildDocumentSignedUrlResponse(
          this.supabaseService.getClient(),
          refreshed.storageKey,
          tenantId,
        );
      }
    }

    return buildDocumentSignedUrlResponse(
      this.supabaseService.getClient(),
      doc.storageKey,
      tenantId,
    );
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
    return withDriverEndpointPerf(
      "GET /api/drivers/jobs/active",
      {
        date: query?.date ?? null,
        month: query?.month ?? null,
        page: query?.page ?? null,
      },
      () => this.listActiveByDriverInner(tenantId, driverUserId, query),
      (res) => {
        try {
          return JSON.stringify(res).length;
        } catch {
          return undefined;
        }
      },
    );
  }

  private async listActiveByDriverInner(
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

    const tripsWhereForDriverHome: Prisma.TripWhereInput = {
      assignedDriverUserId: driverUserId,
      status:
        dateStr || month
          ? { in: [TripStatus.PUBLISHED, TripStatus.ONGOING] }
          : { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] },
    };

    const includeActiveJobRelations = {
      customerCompany: {
        select: { id: true, name: true },
      },
      assignedDriver: {
        select: { id: true, name: true },
      },
      trips: {
        where: tripsWhereForDriverHome,
        orderBy: [{ plannedStartAt: "asc" as const }, { createdAt: "asc" as const }],
      },
      documents: DRIVER_ACTIVE_JOB_DOCUMENTS_INCLUDE,
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

    const data = jobs.map((job: any) => {
      const dto = toJobDto({
        ...job,
        items: [],
        assignedVehiclePlateNo: (() => {
          const primaryTrip = (job.trips ?? [])[0];
          return (
            (primaryTrip?.vehicleId && vehicleMap.get(primaryTrip.vehicleId)) ||
            (primaryTrip?.fleetVehicleId && vehicleMap.get(primaryTrip.fleetVehicleId)) ||
            null
          );
        })(),
      });

      return {
        ...dto,
        documents: (job.documents ?? []).map((doc: any) => this.toDocumentMetadataDto(doc)),
      };
    });

    const runSheet = dateStr
      ? await this.buildDriverDailyRunSheet(tenantId, driverUserId, dateStr)
      : null;

    return {
      data,
      meta: buildPaginationMeta(page, pageSize, total),
      runSheet,
    };
  }

  private readonly driverHomeTripInclude = {
    payoutLines: {
      select: CANONICAL_TRIP_PAYOUT_LINE_SELECT,
    },
    job: {
      select: {
        id: true,
        internalRef: true,
        pickupDate: true,
        pickupReference: true,
        description: true,
        pickupAddress1: true,
        pickupAddress2: true,
        pickupPostal: true,
        deliveryAddress1: true,
        deliveryAddress2: true,
        deliveryPostal: true,
        notes: true,
        jobType: true,
        customerCompany: { select: { name: true } },
      },
    },
  } as const;

  private toCalendarDate(value: Date | string | null | undefined): Date | null {
    if (value == null) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** Calendar day from trip.plannedStartAt only (tenant timezone). */
  private getTripPlannedCalendarDayKey(
    trip: { plannedStartAt?: Date | string | null },
    timeZone: string,
  ): string | null {
    const d = this.toCalendarDate(trip.plannedStartAt ?? null);
    return d ? this.getDateKeyInTimeZone(d, timeZone) : null;
  }

  /** Trip day for home grouping: plannedStartAt first, else job pickupDate. */
  private getTripCalendarDayKey(
    trip: { plannedStartAt?: Date | string | null },
    job: { pickupDate?: Date | string | null } | null | undefined,
    timeZone: string,
  ): string | null {
    const plannedDay = this.getTripPlannedCalendarDayKey(trip, timeZone);
    if (plannedDay) return plannedDay;
    const pickup = this.toCalendarDate(job?.pickupDate ?? null);
    return pickup ? this.getDateKeyInTimeZone(pickup, timeZone) : null;
  }

  private buildDriverHomeActiveTripsWhere(
    tenantId: string,
    driverUserId: string,
  ): Prisma.TripWhereInput {
    return {
      tenantId,
      assignedDriverUserId: driverUserId,
      status: { in: [TripStatus.PUBLISHED, TripStatus.ONGOING] },
      job: {
        tenantId,
        status: { in: [JobStatus.ONGOING] },
        ...this.publishedTripVisibilityWhere(),
      },
    };
  }

  private async fetchDriverHomeActiveAssignedTrips(
    tenantId: string,
    driverUserId: string,
  ) {
    const trips = await this.prisma.trip.findMany({
      where: this.buildDriverHomeActiveTripsWhere(tenantId, driverUserId),
      include: this.driverHomeTripInclude,
    });
    return [...trips].sort((a: any, b: any) =>
      compareTripsByEffectiveSchedule(
        {
          id: a.id,
          plannedStartAt: a.plannedStartAt,
          jobPickupDate: a.job?.pickupDate,
          tripSequence: a.tripSequence,
          jobSequence: a.jobSequence,
          createdAt: a.createdAt,
        },
        {
          id: b.id,
          plannedStartAt: b.plannedStartAt,
          jobPickupDate: b.job?.pickupDate,
          tripSequence: b.tripSequence,
          jobSequence: b.jobSequence,
          createdAt: b.createdAt,
        },
      ),
    );
  }

  private classifyOutsideTodayBucket(
    dayKey: string | null,
    requestedDateKey: string,
  ): "needsAttention" | "upcoming" | "unscheduled" | null {
    if (!dayKey) return "unscheduled";
    if (dayKey < requestedDateKey) return "needsAttention";
    if (dayKey > requestedDateKey) return "upcoming";
    return null;
  }

  private isTripOnRequestedCalendarDay(
    trip: { plannedStartAt?: Date | string | null },
    job: { pickupDate?: Date | string | null } | null | undefined,
    requestedDateKey: string,
    timeZone: string,
  ): boolean {
    const plannedDay = this.getTripPlannedCalendarDayKey(trip, timeZone);
    if (plannedDay) return plannedDay === requestedDateKey;
    const pickup = this.toCalendarDate(job?.pickupDate ?? null);
    const pickupDay = pickup ? this.getDateKeyInTimeZone(pickup, timeZone) : null;
    return pickupDay === requestedDateKey;
  }

  private toDriverHomeJobCardFromTrips(job: any, trips: any[]) {
    const primary = trips[0];
    return {
      jobId: job.id,
      jobInternalRef: job.internalRef,
      customerName: job.customerCompany?.name ?? null,
      jobType: job.jobType,
      collectionType: job.collectionType ?? null,
      status: JobStatus.ONGOING,
      pickupDate: job.pickupDate ?? null,
      originSummary:
        firstNonEmptyText(
          primary?.originLabel,
          primary?.originAddressLine1,
          job.pickupAddress1,
        ) ?? null,
      destinationSummary:
        firstNonEmptyText(
          primary?.destinationLabel,
          primary?.destinationAddressLine1,
          job.deliveryAddress1,
        ) ?? null,
    };
  }

  private toDriverHomeTripCard(t: any, j: any) {
    const exec = buildDriverTripExecutionCard(t, j);
    const template = t.jobTripTemplate ?? null;
    const title = t.title ?? t.displayTitle ?? null;
    return {
      tripId: t.id,
      jobId: t.jobId ?? j?.id ?? null,
      tripDisplayRef: buildTripDisplayRef({
        jobInternalRef: j?.internalRef ?? exec.jobInternalRef ?? null,
        tripSequence: t.tripSequence ?? null,
        jobSequence: t.jobSequence ?? null,
        tripId: t.id,
      }),
      jobInternalRef: j?.internalRef ?? exec.jobInternalRef ?? null,
      customerName: exec.customerName,
      title,
      routeLabel: template ? jobTripTemplateDisplayLabel(template) : title,
      jobTripTemplate: template,
      status: t.status,
      pendingState: t.pendingState ?? TripPendingState.NONE,
      plannedStartAt: t.plannedStartAt ?? null,
      pickupDate: j?.pickupDate ?? null,
      pickupReference: j?.pickupReference ?? null,
      startedAt: t.startedAt ?? null,
      originSummary: exec.originSummary,
      destinationSummary: exec.destinationSummary,
      pickupAddress1: exec.pickupAddress1,
      pickupPostal: exec.pickupPostal,
      deliveryAddress1: exec.deliveryAddress1,
      deliveryPostal: exec.deliveryPostal,
      trailerNumber: t.trailerNumber ?? null,
      driverRemarks: t.driverRemarks ?? null,
      driverEarningCents: resolveDriverTripEarningCents(t),
      driverEarningCurrency: DEFAULT_DRIVER_EARNING_CURRENCY,
    };
  }

  async getDriverHome(
    tenantId: string,
    driverUserId: string,
    dateStr: string,
  ): Promise<{
    date: string;
    today: {
      jobs: ReturnType<DriverJobsService["toDriverHomeJobCardFromTrips"]>[];
      trips: ReturnType<DriverJobsService["toDriverHomeTripCard"]>[];
      runSheet: any;
      summary: {
        total: number;
        completed: number;
        ongoing: number;
        nextTripId: string | null;
        currentTripId: string | null;
      };
    };
    assignedOutsideToday: {
      needsAttention: ReturnType<DriverJobsService["toDriverHomeTripCard"]>[];
      upcoming: ReturnType<DriverJobsService["toDriverHomeTripCard"]>[];
      unscheduled: ReturnType<DriverJobsService["toDriverHomeTripCard"]>[];
    };
  }> {
    return withDriverEndpointPerf(
      "GET /api/drivers/home",
      { date: dateStr },
      async () => {
        const trimmed = String(dateStr ?? "").trim();
        if (!trimmed) {
          throw new BadRequestException("date query param is required");
        }
        const tz = await this.getTenantTimeZone(tenantId);
        this.parseCalendarDateToUtcRangeInTimeZone(trimmed, tz);
        const requestedDateKey = trimmed;

        const runSheet = await this.buildDriverDailyRunSheet(
          tenantId,
          driverUserId,
          trimmed,
        );
        const allActiveTrips = await this.fetchDriverHomeActiveAssignedTrips(
          tenantId,
          driverUserId,
        );

        const todayTripCardsById = new Map<
          string,
          ReturnType<DriverJobsService["toDriverHomeTripCard"]>
        >();
        const assignedOutsideToday = {
          needsAttention: [] as ReturnType<DriverJobsService["toDriverHomeTripCard"]>[],
          upcoming: [] as ReturnType<DriverJobsService["toDriverHomeTripCard"]>[],
          unscheduled: [] as ReturnType<DriverJobsService["toDriverHomeTripCard"]>[],
        };
        const todayJobsByJobId = new Map<
          string,
          { job: any; trips: any[] }
        >();

        for (const t of allActiveTrips) {
          const job = t.job;
          if (!job) continue;
          const dayKey = this.getTripCalendarDayKey(t, job, tz);
          const card = this.toDriverHomeTripCard(t, job);

          if (this.isTripOnRequestedCalendarDay(t, job, requestedDateKey, tz)) {
            todayTripCardsById.set(t.id, card);
            const existing = todayJobsByJobId.get(job.id);
            if (existing) {
              existing.trips.push(t);
            } else {
              todayJobsByJobId.set(job.id, { job, trips: [t] });
            }
            continue;
          }

          const bucket = this.classifyOutsideTodayBucket(dayKey, requestedDateKey);
          if (!bucket) continue;
          assignedOutsideToday[bucket].push(card);
        }

        const todayTrips: ReturnType<DriverJobsService["toDriverHomeTripCard"]>[] = [];
        if (runSheet?.trips?.length) {
          for (const rs of runSheet.trips) {
            const card = rs?.tripId ? todayTripCardsById.get(rs.tripId) : undefined;
            if (card) todayTrips.push(card);
          }
        }
        if (!todayTrips.length) {
          todayTrips.push(...todayTripCardsById.values());
        }

        const todayJobs = [...todayJobsByJobId.values()].map(({ job, trips }) =>
          this.toDriverHomeJobCardFromTrips(job, trips),
        );

        const summary = {
          total: runSheet?.totalTrips ?? 0,
          completed: runSheet?.completedTrips ?? 0,
          ongoing: runSheet?.ongoingTrips ?? 0,
          nextTripId: runSheet?.nextTripId ?? null,
          currentTripId: runSheet?.currentTripId ?? null,
        };

        return {
          date: requestedDateKey,
          today: {
            jobs: todayJobs,
            trips: todayTrips,
            runSheet: runSheet ?? {
              runDate: requestedDateKey,
              driverId: driverUserId,
              driverName: null,
              totalTrips: 0,
              completedTrips: 0,
              ongoingTrips: 0,
              nextTripId: null,
              currentTripId: null,
              routeVersion: null,
              routeOptimisedAt: null,
              routeOptimisedByUserId: null,
              routeOptimisedByName: null,
              trips: [],
            },
            summary,
          },
          assignedOutsideToday,
        };
      },
      (res) => {
        try {
          return JSON.stringify(res).length;
        } catch {
          return undefined;
        }
      },
    );
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
            (job.documents ?? []).map((doc: any) => this.toDocumentMetadataDto(doc)),
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
    const earnings =
      this.tripEarnings ?? new DriverTripEarningsService(this.prisma);
    const summary = await earnings.getWalletSummaryByMonth(
      tenantId,
      driverUserId,
      month,
    );
    return {
      ...summary,
      trips: summary.trips.map((t) => ({
        ...t,
        status: t.status as TripStatus,
      })),
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
        include: documentUploadedByInclude,
      },
      trips: {
        where: { status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] } },
        orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }],
        include: {
          documents: {
            where: { isActive: true },
            orderBy: { createdAt: "desc" },
            include: documentUploadedByInclude,
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

    const tripsWithUrls = (job.trips ?? []).map((t: any) => {
      const documentsWithUrls = (t.documents ?? []).map((d: any) =>
        this.attachTripDocumentMetadata(d),
      );
      return {
        ...t,
        documentsWithUrls,
      };
    });

    const dto = toJobDto({
      ...job,
      trips: tripsWithUrls,
      assignedVehiclePlateNo,
    });

    dto.documents = (job.documents ?? []).map((doc: any) =>
      this.toDocumentMetadataDto(doc),
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

    const tz = await this.getTenantTimeZone(tenantId);
    const startGate = evaluateTripStartDateGate({
      plannedStartAt: trip.plannedStartAt ?? null,
      jobPickupDate: (job as { pickupDate?: Date | null }).pickupDate ?? null,
      timeZone: tz,
    });
    if (startGate.allowed === false) {
      throw new BadRequestException(tripStartDateGateErrorMessage(startGate));
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

    const uploadActor = await loadUploadActorFields(
      this.prisma,
      driverUserId,
    );
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
          ...uploadActor,
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
    });

    await syncJobInvoiceReadiness(
      this.prisma as unknown as JobInvoiceSyncPrisma,
      tenantId,
      jobId,
    );

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

    rt.publishTripEvent(this.realtime, "trip.started", tenantId, jobId, tripId, {
      driverUserId,
      actorUserId: driverUserId,
      actorRole: Role.DRIVER,
      tripStatus: TripStatus.ONGOING,
    });
    rt.publishDriverActiveJobsUpdated(this.realtime, tenantId, driverUserId);

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

    this.realtime?.publishDriverLocationUpdated(tenantId, driverUserId, {
      jobId,
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

  private async buildContainerDocumentationForTrip(
    tenantId: string,
    jobId: string,
    tripId: string,
    jobType: JobType,
    documents: Array<{
      type: TripDocumentType;
      jobItemId?: string | null;
      isActive?: boolean | null;
    }>,
  ): Promise<ContainerDocumentationRequirement[]> {
    if (!isContainerCargoJobType(jobType)) return [];

    // Phase 1: requirements scoped to explicit TripJobItem links only.
    // Empty links ⇒ empty requirements (complete fails when container-based with items but no links).
    const links = await loadTripJobItemLinks(this.prisma as any, tenantId, tripId);
    if (links.length === 0) return [];

    const items = links.map((link) => ({
      id: link.jobItem.id,
      itemCode: link.jobItem.itemCode,
      sealNo: link.jobItem.sealNo,
    }));
    return buildContainerDocumentationRequirements(items, documents);
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

    const [completionDocs, trailerCheckout] = await Promise.all([
      this.prisma.tripDocument.findMany({
        where: {
          tenantId,
          tripId,
          isActive: true,
          type: { in: DriverJobsService.COMPLETION_DOC_QUERY_TYPES },
        },
        select: {
          type: true,
          jobItemId: true,
          isActive: true,
          signedAt: true,
          isSigned: true,
        },
      }),
      this.computeTrailerCheckoutGapsForTrip(tenantId, driverUserId, trip, {
        trailerParkingLocationCode: payload?.trailerParkingLocationCode,
        hasNewTrailerEndPhotoUpload: !!payload?.trailerEndPhoto?.buffer?.length,
      }),
    ]);
    const containerDocumentation = await this.buildContainerDocumentationForTrip(
      tenantId,
      jobId,
      tripId,
      job.jobType as JobType,
      completionDocs,
    );
    if (isContainerCargoJobType(job.jobType as JobType)) {
      const jobItemCount = await this.prisma.jobItem.count({
        where: { tenantId, jobId },
      });
      if (
        isContainerBasedTransportJob(job.jobType as JobType, jobItemCount)
        && containerDocumentation.length === 0
      ) {
        throw new BadRequestException(
          "Trip has no linked cargo items (TripJobItem). Explicit linkage is required before completion.",
        );
      }
    }
    const missingContainerDocumentation = containerDocumentation.filter(
      (requirement) => requirement.missing.length > 0,
    );
    if (missingContainerDocumentation.length > 0) {
      const labels = containerDocumentationErrorLabels(
        missingContainerDocumentation,
        containerDocumentation,
      );
      throw new BadRequestException(
        `Container documentation is incomplete for ${labels.join(" and ")}.`,
      );
    }

    const missing = [
      ...buildTripCompletionDocumentGaps(completionDocs),
      ...getMissingContainerDocumentTypes(containerDocumentation),
    ];

    if (missing.length > 0) {
      throw new BadRequestException(
        `Trip cannot be completed yet. Missing required trip documents: ${missing.join(", ")}`,
      );
    }

    const {
      requiresTrailerCheckout,
      missingTrailerCheckoutFields,
      resolvedTrailerParkingLocationCode,
    } = trailerCheckout;

    let trailerLocation: { code: string; name: string } | null = null;
    if (requiresTrailerCheckout) {
      if (
        trailerCheckoutBlocksCompletion(
          requiresTrailerCheckout,
          missingTrailerCheckoutFields,
        )
      ) {
        const blocking = missingTrailerCheckoutFields.filter(
          (f) => f !== "trailerParkingLocationCode",
        );
        throw new BadRequestException(
          `Missing trailer checkout fields: ${blocking.join(", ")}`,
        );
      }

      const trailerEndPhoto = payload?.trailerEndPhoto;
      if (trailerEndPhoto?.buffer?.length) {
        const mime = String(trailerEndPhoto.mimetype ?? "").toLowerCase();
        if (!mime.startsWith("image/")) {
          throw new BadRequestException("trailerEndPhoto must be an image");
        }
      }

      if (resolvedTrailerParkingLocationCode) {
        const location = await this.prisma.masterTrailerLocation.findFirst({
          where: { code: resolvedTrailerParkingLocationCode },
          select: { code: true, name: true },
        });
        if (!location) {
          throw new BadRequestException(
            `Unknown trailerParkingLocationCode: ${resolvedTrailerParkingLocationCode}`,
          );
        }
        trailerLocation = location;
      }
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
        const trailerEndActor = await loadUploadActorFields(
          this.prisma,
          driverUserId,
        );
        await tx.tripDocument.create({
          data: {
            tenantId,
            tripId,
            type: TripDocumentType.TRAILER_END_PHOTO,
            storageKey: key,
            originalName: file.originalname ?? "trailer-end.jpg",
            mimeType: file.mimetype ?? "image/jpeg",
            sizeBytes: file.size ?? null,
            ...trailerEndActor,
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

    await syncJobInvoiceReadiness(
      this.prisma as unknown as JobInvoiceSyncPrisma,
      tenantId,
      jobId,
    );

    const refreshedJob = await this.getOneForDriver(tenantId, jobId, driverUserId);
    const refreshedTrip = refreshedJob.trips.find((t) => t.id === tripId) ?? null;

    rt.publishTripEvent(this.realtime, "trip.completed", tenantId, jobId, tripId, {
      driverUserId,
      actorUserId: driverUserId,
      actorRole: Role.DRIVER,
      tripStatus: TripStatus.COMPLETED,
    });
    rt.publishDriverActiveJobsUpdated(this.realtime, tenantId, driverUserId);

    return {
      requiresTrailerCheckout,
      trip: refreshedTrip,
      job: refreshedJob,
    };
  }

  private async listTrailerParkingLocations() {
    const now = Date.now();
    if (
      trailerParkingLocationsCache
      && trailerParkingLocationsCache.expiresAt > now
    ) {
      return trailerParkingLocationsCache.rows;
    }
    const rows = await this.prisma.masterTrailerLocation.findMany({
      orderBy: [{ code: "asc" }],
      select: { id: true, code: true, name: true },
    });
    trailerParkingLocationsCache = { expiresAt: now + TRAILER_PARKING_LOCATIONS_CACHE_TTL_MS, rows };
    return rows;
  }

  async getTripCompletionRequirements(
    tenantId: string,
    jobId: string,
    tripId: string,
    driverUserId: string,
  ) {
    return withDriverEndpointPerf(
      "GET /api/drivers/jobs/:jobId/trips/:tripId/completion-requirements",
      { jobId, tripId },
      () => this.getTripCompletionRequirementsInner(tenantId, jobId, tripId, driverUserId),
    );
  }

  private async getTripCompletionRequirementsInner(
    tenantId: string,
    jobId: string,
    tripId: string,
    driverUserId: string,
  ) {
    const job = await this.findAssignedJobOrThrow(
      tenantId,
      jobId,
      driverUserId,
    );
    const trip = await this.findPublishedTripOrThrow(tenantId, jobId, tripId);
    if (trip.assignedDriverUserId !== driverUserId) {
      throw new BadRequestException("You are not assigned to this trip");
    }

    const [completionDocs, trailerCheckout] = await Promise.all([
      this.prisma.tripDocument.findMany({
        where: {
          tenantId,
          tripId,
          isActive: true,
          type: { in: DriverJobsService.COMPLETION_DOC_QUERY_TYPES },
        },
        select: {
          type: true,
          jobItemId: true,
          isActive: true,
          signedAt: true,
          isSigned: true,
        },
      }),
      this.computeTrailerCheckoutGapsForTrip(tenantId, driverUserId, trip),
    ]);
    const containerDocumentation = await this.buildContainerDocumentationForTrip(
      tenantId,
      jobId,
      tripId,
      job.jobType as JobType,
      completionDocs,
    );
    const missingContainerDocumentation = containerDocumentation.filter(
      (requirement) => requirement.missing.length > 0,
    );
    const missingDocuments = [
      ...buildTripCompletionDocumentGaps(completionDocs),
      ...getMissingContainerDocumentTypes(containerDocumentation),
    ];
    // Surface missing linkage as a completion gap for container-based trips.
    if (
      isContainerCargoJobType(job.jobType as JobType)
      && containerDocumentation.length === 0
    ) {
      const jobItemCount = await this.prisma.jobItem.count({
        where: { tenantId, jobId },
      });
      if (isContainerBasedTransportJob(job.jobType as JobType, jobItemCount)) {
        missingDocuments.push("LINKED_CARGO");
      }
    }
    const { requiresTrailerCheckout, missingTrailerCheckoutFields } = trailerCheckout;
    const parkingLocations = await this.listTrailerParkingLocations();

    return {
      canComplete: this.resolveTripCanComplete(
        trip.status,
        missingDocuments,
        requiresTrailerCheckout,
        missingTrailerCheckoutFields,
      ),
      missingDocuments,
      containerDocumentation,
      missingContainerDocumentation,
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
    return docs.map((d) => this.toDocumentMetadataDto(d));
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
            TripDocumentType.CONTAINER_PHOTO,
            TripDocumentType.SEAL_PHOTO,
            TripDocumentType.TRAILER_PARKING_PHOTO,
            TripDocumentType.TRAILER_START_PHOTO,
            TripDocumentType.TRAILER_END_PHOTO,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      include: documentUploadedByInclude,
    });
    return docs.map((d) => this.attachTripDocumentMetadata(d));
  }

  async getTripDetailForDriver(
    tenantId: string,
    tripId: string,
    driverUserId: string,
  ): Promise<any> {
    return withDriverEndpointPerf(
      "GET /api/drivers/trips/:tripId",
      { tripId },
      () => this.getTripDetailForDriverInner(tenantId, tripId, driverUserId),
      (res) => {
        try {
          return JSON.stringify(res).length;
        } catch {
          return undefined;
        }
      },
    );
  }

  private async getTripDetailForDriverInner(
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
                sealNo: true,
                pickupReference: true,
                qty: true,
              },
            },
          },
        },
        documents: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          include: documentUploadedByInclude,
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

    const docsWithUrls = (trip.documents ?? []).map((d) =>
      this.attachTripDocumentMetadata(d),
    );

    const trailerStartPhotoUrl: string | null = null;
    const trailerEndPhotoUrl: string | null = null;

    const cargoItems = trip.job?.items ?? [];
    const isContainerMode = isContainerCargoJobType(trip.job?.jobType);
    const jobPickupReference = resolveJobPickupReference(
      trip.job,
      isContainerMode ? cargoItems : null,
    );
    const jobDescription = resolveJobDescription(trip.job, cargoItems, {
      useItemFallback: isContainerMode,
    });

    // Phase 1: cargo from TripJobItem only (no unlinked JobItem fallback for container jobs).
    const tripJobItemLinks = await loadTripJobItemLinks(
      this.prisma as any,
      tenantId,
      tripId,
    );
    const cargoBuilt = buildTripCargoFromLinks({
      jobType: trip.job?.jobType,
      links: tripJobItemLinks,
      allJobItems: cargoItems,
    });
    const cargo =
      cargoBuilt.mode === "CONTAINER"
        ? { mode: "CONTAINER" as const, containers: cargoBuilt.containers ?? [] }
        : {
            mode: "ITEMS" as const,
            items: (cargoBuilt.items ?? []).map((item) => ({
              id: item.id,
              itemCode: item.itemCode ?? null,
              description: item.description ?? null,
              qty: item.qty ?? null,
            })),
          };

    return {
      id: trip.id,
      jobId: trip.jobId,
      tripDisplayRef: buildTripDisplayRef({
        jobInternalRef: trip.job?.internalRef ?? null,
        tripSequence: trip.tripSequence ?? null,
        jobSequence: trip.jobSequence ?? null,
        tripId: trip.id,
      }),
      title: trip.title ?? trip.displayTitle ?? null,
      tripPICName: trip.tripPICName ?? null,
      tripPICContact: trip.tripPICContact ?? null,
      containerNumber: trip.containerNumber ?? null,
      carrier: trip.carrier ?? null,
      shipper: trip.shipper ?? null,
      vessel: trip.vessel ?? null,
      status: trip.status,
      plannedStartAt: trip.plannedStartAt ?? null,
      driverRemarks: trip.driverRemarks ?? null,
      ...resolveTripNotesResponseFields(trip, trip.job),
      ...resolveTripRouteAddressResponseFields(trip),
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
            collectionType: trip.job.collectionType ?? null,
            status: trip.job.status ?? null,
            customerName: trip.job.customerCompany?.name ?? null,
            notes: trip.job.notes ?? null,
            jobNotes: trip.job.notes ?? null,
            pickupDate: trip.job.pickupDate ?? null,
            pickupReference: jobPickupReference,
            description: jobDescription,
            vesselName: (trip.job as any).vesselName ?? null,
            vesselEta: (trip.job as any).vesselEta ?? null,
            carrierName: (trip.job as any).carrierName ?? null,
            voyage: (trip.job as any).voyage ?? null,
            shipper: (trip.job as any).shipper ?? null,
          }
        : null,

      documents: docsWithUrls.map((doc) => ({
        id: doc.id,
        type: doc.type,
        jobItemId: doc.jobItemId ?? null,
        isActive: doc.isActive ?? true,
        status: doc.signedAt ? "SIGNED" : "UPLOADED",
        label: doc.type,
        fileName: doc.fileName,
        originalFileName: doc.originalFileName ?? null,
        mimeType: doc.mimeType ?? null,
        fileSizeBytes: doc.fileSizeBytes ?? null,
        fileUrl: null,
        uploadedAt: doc.uploadedAt ?? doc.createdAt,
        signedAt: doc.signedAt ?? null,
        uploadedByUserId: doc.uploadedByUserId ?? null,
        uploadedByName: doc.uploadedByName ?? null,
        uploadedByEmail: doc.uploadedByEmail ?? null,
        uploadedByCurrentDriver: doc.uploadedByUserId === driverUserId,
        canDelete:
          doc.isActive === true
          && doc.uploadedByUserId === driverUserId
          && !DRIVER_NON_DELETABLE_TRIP_DOC_TYPES.has(doc.type as TripDocumentType)
          && !DRIVER_NON_DELETABLE_TRIP_STATUSES.has(trip.status as TripStatus),
      })),

      cargo,
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

  async updateOperationalDetails(
    tenantId: string,
    jobId: string,
    tripId: string,
    driverUserId: string,
    dto: UpdateDriverOperationalDetailsDto,
  ): Promise<any> {
    await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId);
    const trip = await this.findPublishedTripOrThrow(tenantId, jobId, tripId);
    if (trip.assignedDriverUserId !== driverUserId) {
      throw new BadRequestException("You are not assigned to this trip");
    }
    if (
      trip.status !== TripStatus.PUBLISHED
      && trip.status !== TripStatus.ONGOING
    ) {
      throw new BadRequestException(
        "Operational details can only be edited while the trip is PUBLISHED or ONGOING",
      );
    }

    const containers = dto.containers ?? [];
    const changedFields: string[] = [];
    const itemUpdates: Array<{
      itemId: string;
      previousContainerNumber: string;
      containerNumber?: string | null;
      sealNo?: string | null;
    }> = [];

    if (containers.length > 0) {
      const itemIds = containers.map((c) => String(c.itemId ?? "").trim()).filter(Boolean);
      if (itemIds.length !== containers.length) {
        throw new BadRequestException("Each container update requires itemId");
      }
      const uniqueIds = new Set(itemIds);
      if (uniqueIds.size !== itemIds.length) {
        throw new BadRequestException("Duplicate itemId in containers payload");
      }

      const jobItems = await this.prisma.jobItem.findMany({
        where: { tenantId, jobId, id: { in: itemIds } },
        select: { id: true, itemCode: true, sealNo: true },
      });
      if (jobItems.length !== itemIds.length) {
        throw new BadRequestException(
          "One or more container itemIds do not belong to this job",
        );
      }
      const itemsById = new Map<string, { id: string; itemCode: string; sealNo: string | null }>(
        jobItems.map((i) => [i.id, i]),
      );

      for (const row of containers) {
        const itemId = String(row.itemId).trim();
        const existing = itemsById.get(itemId);
        if (!existing) {
          throw new BadRequestException(
            "One or more container itemIds do not belong to this job",
          );
        }
        const next: {
          itemId: string;
          previousContainerNumber: string;
          containerNumber?: string | null;
          sealNo?: string | null;
        } = {
          itemId,
          previousContainerNumber: existing.itemCode,
        };
        if (row.containerNumber !== undefined) {
          const containerNumber = normalizeOptionalTrimmedText(row.containerNumber);
          if (!containerNumber) {
            throw new BadRequestException("containerNumber cannot be empty");
          }
          next.containerNumber = containerNumber;
          changedFields.push("containerNumber");
        }
        if (row.sealNumber !== undefined || row.sealNo !== undefined) {
          next.sealNo = resolveSealNoFromItemInput({
            sealNo: row.sealNo,
            sealNumber: row.sealNumber,
          });
          changedFields.push("sealNumber");
        }
        if (next.containerNumber !== undefined || next.sealNo !== undefined) {
          itemUpdates.push(next);
        }
      }
    }

    let driverRemarksValue: string | null | undefined;
    if (dto.driverRemarks !== undefined) {
      driverRemarksValue = normalizeOptionalTrimmedText(dto.driverRemarks);
      changedFields.push("driverRemarks");
    }

    if (!changedFields.length) {
      return this.getTripDetailForDriver(tenantId, tripId, driverUserId);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const update of itemUpdates) {
        const data: { itemCode?: string; sealNo?: string | null } = {};
        if (update.containerNumber !== undefined) {
          data.itemCode = update.containerNumber!;
        }
        if (update.sealNo !== undefined) {
          data.sealNo = update.sealNo;
        }
        await tx.jobItem.update({
          where: { id: update.itemId },
          data,
        });

        // Preserve 1:1 trip.containerNumber when it matched the previous item code.
        if (
          update.containerNumber !== undefined
          && trip.containerNumber === update.previousContainerNumber
        ) {
          await tx.trip.update({
            where: { id: tripId },
            data: { containerNumber: update.containerNumber },
          });
        }
      }

      if (driverRemarksValue !== undefined) {
        await tx.trip.update({
          where: { id: tripId },
          data: { driverRemarks: driverRemarksValue },
        });
      }
    });

    await this.audit.log(
      tenantId,
      "TRIP_OPERATIONAL_DETAILS_UPDATE",
      "TRIP",
      tripId,
      {
        jobId,
        changedFields: [...new Set(changedFields)],
        containers: itemUpdates.map((u) => ({
          itemId: u.itemId,
          containerNumber: u.containerNumber,
          sealNumber: u.sealNo,
        })),
        driverRemarks: driverRemarksValue,
      },
      driverUserId,
    );

    rt.publishTripEvent(this.realtime, "trip.updated", tenantId, jobId, tripId, {
      driverUserId,
      actorUserId: driverUserId,
      actorRole: Role.DRIVER,
      tripStatus: trip.status as TripStatus,
    });

    return this.getTripDetailForDriver(tenantId, tripId, driverUserId);
  }

  async uploadTripDocumentForDriver(
    tenantId: string,
    jobId: string,
    tripId: string,
    driverUserId: string,
    type: TripDocumentType,
    file: Express.Multer.File,
    requiresSignature = false,
    uploadActorHint?: { name?: string | null; email?: string | null },
    jobItemId?: string | null,
  ): Promise<JobDocumentDto> {
    const perf = createDriverTripDocUploadPerfTimer({
      endpoint: "POST /api/drivers/jobs/:jobId/trips/:tripId/documents",
      tenantId,
      jobId,
      tripId,
      documentType: type,
      fileSizeBytes: file?.size ?? null,
      mimeType: file?.mimetype ?? null,
    });
    perf.markFileParsed();

    if (!file?.buffer?.length) {
      throw new BadRequestException("Trip document file is required");
    }

    if (!DRIVER_UPLOADABLE_TRIP_DOCUMENT_TYPE_SET.has(type)) {
      console.warn("driver_trip_doc_upload_rejected", {
        receivedType: type,
        supportedTypes: [...DRIVER_UPLOADABLE_TRIP_DOCUMENT_TYPES],
        tripId,
        userId: driverUserId,
      });
      throw new BadRequestException("Unsupported trip document type");
    }

    const mime = String(file.mimetype ?? "").toLowerCase();
    if (
      !mime.startsWith("image/") &&
      type !== TripDocumentType.PICKUP_DO &&
      type !== TripDocumentType.DELIVERY_DO &&
      type !== TripDocumentType.OTHER
    ) {
      throw new BadRequestException("Unsupported file type for this trip document");
    }

    perf.markAuthDbStart();
    const [job, trip] = await Promise.all([
      this.findAssignedJobOrThrow(tenantId, jobId, driverUserId),
      this.findPublishedTripOrThrow(tenantId, jobId, tripId),
    ]);
    perf.markAuthDbEnd();

    if (trip.assignedDriverUserId !== driverUserId) {
      throw new BadRequestException("You are not assigned to this trip");
    }

    const isContainerLinkedType =
      type === TripDocumentType.CONTAINER_PHOTO
      || type === TripDocumentType.SEAL_PHOTO;
    const normalizedJobItemId = String(jobItemId ?? "").trim() || null;

    if (isContainerLinkedType && !normalizedJobItemId) {
      throw new BadRequestException(
        `jobItemId is required for ${type}`,
      );
    }
    if (!isContainerLinkedType && normalizedJobItemId) {
      throw new BadRequestException(
        "jobItemId is only allowed for CONTAINER_PHOTO and SEAL_PHOTO",
      );
    }
    if (isContainerLinkedType) {
      if (!isContainerCargoJobType(job.jobType as JobType)) {
        throw new BadRequestException(
          "Container photo documentation is only valid for container-style jobs",
        );
      }
      // Phase 1: must belong to job AND be explicitly linked via TripJobItem.
      const item = await this.prisma.jobItem.findFirst({
        where: {
          id: normalizedJobItemId!,
          tenantId,
          jobId,
        },
        select: { id: true },
      });
      if (!item) {
        throw new BadRequestException(
          "jobItemId does not belong to this trip's job and tenant",
        );
      }
      await assertJobItemLinkedToTrip(
        this.prisma as any,
        tenantId,
        tripId,
        normalizedJobItemId!,
      );
    }

    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg";
    const itemPath = normalizedJobItemId ? `/${normalizedJobItemId}` : "";
    const key = `${tenantId}/jobs/${jobId}/trips/${tripId}/${type.toLowerCase()}${itemPath}/${Date.now()}${ext}`;

    const supabase = this.supabaseService.getClient();
    perf.markStorageUploadStart();
    const { error } = await supabase.storage
      .from(JOB_DOCUMENTS_BUCKET)
      .upload(key, file.buffer, {
        contentType: file.mimetype ?? "application/octet-stream",
        upsert: false,
      });
    perf.markStorageUploadEnd();
    if (error) {
      throw new BadRequestException(`Storage upload failed: ${error.message}`);
    }

    perf.markDbWriteStart();
    if (DRIVER_SINGLE_ACTIVE_TRIP_DOCUMENT_TYPES.has(type)) {
      await this.prisma.tripDocument.updateMany({
        where: {
          tenantId,
          tripId,
          type,
          isActive: true,
          ...(isContainerLinkedType
            ? { jobItemId: normalizedJobItemId }
            : {}),
        },
        data: { isActive: false },
      });
    }

    const uploadActor = await loadUploadActorFields(
      this.prisma,
      driverUserId,
      uploadActorHint,
    );
    const doc = await this.prisma.tripDocument.create({
      data: {
        tenantId,
        tripId,
        jobItemId: normalizedJobItemId,
        type,
        isActive: true,
        storageKey: key,
        originalName: file.originalname ?? "upload",
        mimeType: file.mimetype ?? "application/octet-stream",
        sizeBytes: file.size ?? null,
        ...uploadActor,
        requiresSignature:
          type === TripDocumentType.POD_SIGNATURE
            ? false
            : !!requiresSignature,
      },
      include: documentUploadedByInclude,
    });

    await this.audit.log(
      tenantId,
      "TRIP_DOC_UPLOAD",
      "TRIP",
      tripId,
      {
        jobId,
        documentId: doc.id,
        type,
        jobItemId: normalizedJobItemId,
      },
      driverUserId,
    );
    perf.markDbWriteEnd();

    perf.markSideEffectsStart();
    rt.publishDocumentEvent(this.realtime, "document.uploaded", tenantId, doc.id, {
      jobId,
      tripId,
      driverUserId,
      actorUserId: driverUserId,
      actorRole: Role.DRIVER,
      tripStatus: trip.status as TripStatus,
    });
    if (type === TripDocumentType.POD_SIGNATURE) {
      await this.opsJobs?.refreshSignedDoPdf(
        tenantId,
        jobId,
        tripId,
        TripDocumentType.DELIVERY_DO,
        { signatureImageBytes: file.buffer, signedAt: new Date() },
      );
    }
    perf.markSideEffectsEnd();

    const result = this.toDocumentMetadataDto(doc);
    perf.finish(result);
    return result;
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

    if (DRIVER_NON_DELETABLE_TRIP_DOC_TYPES.has(doc.type)) {
      throw new BadRequestException("Trailer photos cannot be deleted.");
    }

    if (doc.uploadedByUserId !== driverUserId) {
      throw new ForbiddenException("You can only delete documents you uploaded.");
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
      { jobId, documentId: doc.id, type: doc.type, uploadedByUserId: doc.uploadedByUserId ?? null },
      driverUserId,
    );

    rt.publishDocumentEvent(this.realtime, "document.deleted", tenantId, doc.id, {
      jobId,
      tripId,
      driverUserId,
      actorUserId: driverUserId,
      actorRole: Role.DRIVER,
      tripStatus: trip.status as TripStatus,
    });

    return { success: true, documentId: doc.id };
  }

  async signTripDocumentForDriver(
    tenantId: string,
    jobId: string,
    tripId: string,
    documentId: string,
    driverUserId: string,
    body?: SignTripDocumentBody,
  ): Promise<JobDocumentDto> {
    await this.findAssignedJobOrThrow(tenantId, jobId, driverUserId);
    const trip = await this.findPublishedTripOrThrow(tenantId, jobId, tripId);
    const doc = await this.prisma.tripDocument.findFirst({
      where: { id: documentId, tenantId, tripId, isActive: true },
    });
    if (!doc) throw new NotFoundException("Trip document not found");
    if (
      doc.type === TripDocumentType.POD_SIGNATURE
      || doc.type === TripDocumentType.PICKUP_SIGNATURE
      || doc.type === TripDocumentType.DELIVERY_SIGNATURE
    ) {
      throw new BadRequestException(
        "Signature image documents cannot be signed separately; sign the Pickup/Delivery DO instead",
      );
    }

    const isDoDocument = isSignableDoType(doc.type);
    if (isDoDocument && !tripStatusAllowsDoSign(trip.status as TripStatus)) {
      throw new BadRequestException(DO_SIGN_REQUIRES_ONGOING_TRIP_MESSAGE);
    }

    const signatureImageBytes = parseSignatureImageBytes(body);
    const signatureContentType = parseSignatureContentType(body);
    const signedAt = parseSignedAtFromBody(body) ?? new Date();
    const normalizedSignedByName = body?.signedByName?.trim() || null;

    let newSignatureDocId: string | null = null;
    try {
      if (isDoDocument && signatureImageBytes?.length) {
        const persisted = await this.opsJobs!.persistSignedDoSignatureImage(
          tenantId,
          jobId,
          tripId,
          doc.type,
          {
            signatureImageBytes,
            mimeType: signatureContentType,
            signedByName: normalizedSignedByName,
            signedAt,
            signedByUserId: driverUserId,
            signBody: body,
            replaceExisting: false,
          },
        );
        newSignatureDocId = persisted.id;
      }

      if (isDoDocument) {
        await this.opsJobs?.refreshSignedDoPdf(tenantId, jobId, tripId, doc.type, {
          signatureImageBytes,
          recipientName: normalizedSignedByName ?? doc.signedByName,
          signedAt,
        });
      }

      const updated = await this.prisma.tripDocument.update({
        where: { id: documentId },
        data: {
          isSigned: true,
          signedAt,
          signedByUserId: driverUserId,
          signedByName: normalizedSignedByName,
        },
        include: documentUploadedByInclude,
      });

      if (isDoDocument && newSignatureDocId) {
        await this.opsJobs?.deactivatePreviousSignedDoSignatureArtifacts(
          tenantId,
          tripId,
          doc.type,
          newSignatureDocId,
        );
      }

      await this.audit.log(
        tenantId,
        "TRIP_DOC_SIGN",
        "TRIP",
        tripId,
        { jobId, documentId },
        driverUserId,
      );
      rt.publishDocumentEvent(this.realtime, "document.signed", tenantId, documentId, {
        jobId,
        tripId,
        driverUserId,
        actorUserId: driverUserId,
        actorRole: Role.DRIVER,
        tripStatus: trip.status as TripStatus,
      });

      if (isDoDocument) {
        const refreshed = await this.prisma.tripDocument.findFirst({
          where: { id: documentId, tenantId, tripId, isActive: true },
          include: documentUploadedByInclude,
        });
        if (refreshed) {
          return this.attachTripDocumentSignedUrl(refreshed);
        }
      }

      return this.attachTripDocumentSignedUrl(updated);
    } catch (error) {
      if (newSignatureDocId) {
        await this.prisma.tripDocument.update({
          where: { id: newSignatureDocId },
          data: { isActive: false },
        });
      }
      throw error;
    }
  }
}
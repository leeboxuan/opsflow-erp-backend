import * as fs from "fs";
import path from "path";

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import {
  JobStatus,
  JobTripTemplate,
  JobChargeSourceType,
  JobType,
  JobDocumentType,
  LogisticsLocationType,
  MasterFileStatus,
  MasterFileType,
  MasterRateDatasetStatus,
  MasterRateDatasetType,
  MembershipStatus,
  Prisma,
  Role,
  TripPendingState,
  TripDocumentType,
  TripStatus,
} from "@prisma/client";
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

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
import { buildDocumentFileDisplayFields } from "../common/document-file-display";
import { buildTripDisplayRef } from "../common/trip-display-ref";
import { suggestTripOrderByNearestNeighbour } from "../common/trip-order-suggest";
import {
  evaluateJobInvoiceReadiness,
  isInvoiceReadyTripStatus,
} from "./job-invoice-readiness";

import { CreateJobDto } from "./dto/create-job.dto";
import { UpdateJobDto } from "./dto/update-job.dto";
import { AssignJobDto } from "./dto/assign-job.dto";
import { CancelJobDto } from "./dto/cancel-job.dto";
import { JobListQueryDto } from "./dto/job-list-query.dto";
import {
  JobDto,
  JobDocumentDto,
  JobTrackingDto,
  JobTripResponseDto,
  AuditLogEntryDto,
} from "./dto/job.dto";
import { SaveJobChargesDto } from "./dto/save-job-charges.dto";
import {
  AppendJobTripDto,
  AssignJobTripDto,
  PatchTripPayoutDto,
  PatchJobTripDto,
  PublishJobTripRouteDto,
  ReorderJobTripsDto,
  SuggestJobTripOrderDto,
  TripPayoutLineInputDto,
} from "./dto/job-trip.dto";
import {
  tripCreateManyForJob,
  completionRuleForTemplate,
} from "./job-workflow.helpers";
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
import type {
  JobBatchImportPreviewResponseDto,
  JobBatchImportConfirmRequestDto,
  JobBatchImportConfirmResponseDto,
} from "./dto/job-batch-import.dto";
import {
  buildBatchImportJobCreateData,
  buildJobBatchImportRowDto,
  normalizeJobBatchImportRowFromBody,
  parseJobBatchImportSheet,
  validateJobBatchImportRowFields,
} from "./job-batch-import.helpers";

const JOB_DOCUMENTS_BUCKET = "job-documents";

const QUOTATION_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

const QUOTATION_EXT = /\.(pdf|xlsx|xls)$/i;

const OTHER_JOB_DOC_EXT =
  /\.(pdf|xlsx|xls|csv|doc|docx|jpg|jpeg|png|webp|txt|zip)$/i;

const OTHER_JOB_DOC_MIMES = new Set<string>([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/zip",
  "application/x-zip-compressed",
]);

function toDocDto(d: any): JobDocumentDto {
  const uploadedByName = String(
    d?.uploadedByName
    ?? d?.uploadedBy?.name
    ?? d?.uploadedByNameSnapshot
    ?? "",
  ).trim();
  const uploadedByEmail = String(d?.uploadedBy?.email ?? d?.uploadedByEmail ?? "").trim();
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
    uploadedByName: uploadedByName || uploadedByEmail || (d.generatedBySystem ? "System" : null),
    generatedBySystem: d.generatedBySystem ?? false,
    generatedSource: d.generatedSource ?? null,
    jobId: d.jobId ?? null,
    tripId: d.tripId ?? null,
    downloadUrl: d.downloadUrl ?? d.url ?? null,
    previewUrl: d.previewUrl ?? d.url ?? null,
    requiresSignature: d.requiresSignature ?? false,
    isSigned: d.isSigned ?? false,
    signedAt: d.signedAt ?? null,
    signedByUserId: d.signedByUserId ?? null,
    signedByName: d.signedByName ?? null,
  };
}

const TRIP_DOC_ALLOWED_TYPES = new Set<string>([
  TripDocumentType.PICKUP_DO,
  TripDocumentType.DELIVERY_DO,
  TripDocumentType.POD_PHOTO,
  TripDocumentType.POD_SIGNATURE,
  TripDocumentType.OTHER,
]);

function normalizeExternalRef(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toJobDto(j: any): JobDto {
  const trips = Array.isArray(j.trips) ? j.trips : [];
  const primaryTrip =
    trips.find((t: any) => t.status !== TripStatus.DRAFT && t.status !== TripStatus.CANCELLED)
    ?? trips[0]
    ?? null;
  const assignedDriverName = j.assignedDriver
    ? j.assignedDriver.name?.trim() || j.assignedDriver.email || null
    : null;

  const createdByName = j.createdBy
    ? j.createdBy.name?.trim() || j.createdBy.email || null
    : null;

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
    status: j.status,
    invoiceReadyAt: j.invoiceReadyAt ?? null,
    isInvoiceReady: !!j.invoiceReadyAt,
    computedInvoiceReady: computedReadiness?.readyForInvoice ?? undefined,
    computedInvoiceReadinessReason: computedReadiness?.reason ?? null,
    notes: j.notes ?? null,

    createdByUserId: j.createdByUserId ?? null,
    createdByName,
    createdByEmail: j.createdBy?.email ?? null,

    pickupPortCode: j.pickupPortCode ?? null,
    portTerminalCode: j.portTerminalCode ?? null,
    portName: j.portName ?? null,
    psaStorageRentLastDay: j.psaStorageRentLastDay ?? null,
    vesselName: j.vesselName ?? null,
    vesselEta: j.vesselEta ?? null,
    portnetReady: j.portnetReady ?? false,
    permitReady: j.permitReady ?? false,
    returningDepotCode: j.returningDepotCode ?? null,
    returnLastDay: j.returnLastDay ?? null,
    exportOriginDepotCode: j.exportOriginDepotCode ?? null,
    exportPortCode: j.exportPortCode ?? null,

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

    assignedDriverId: primaryTrip?.assignedDriverUserId ?? null,
    assignedDriverName,
    assignedVehicleId: primaryTrip?.vehicleId ?? null,
    assignedFleetVehicleId: primaryTrip?.fleetVehicleId ?? null,
    assignedVehiclePlateNo: (j as any).assignedVehiclePlateNo ?? null,

    assignedAt: primaryTrip?.assignedAt ?? null,
    startedAt: null,
    completedAt: null,
    deliveredAt: null,
    podRecipientName: null,

    cancelledReason: j.cancelledReason,
    cancelledAt: j.cancelledAt,
    cancelledByUserId: j.cancelledByUserId,

    lastLat: null,
    lastLng: null,
    lastLocationAt: null,

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

    trips:
      j.trips?.map((t: any) => ({
        ...deriveTripRouteSummaryFromJobAndTemplate(j, t),
        id: t.id,
        jobId: j.id,
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
        displayTitle: t.displayTitle ?? t.title ?? null,
        createdAt: t.createdAt ?? null,
        createdByUserId: t.createdByUserId ?? null,
        updatedByUserId: t.updatedByUserId ?? null,
        updatedByName: null,
        publishedAt: t.publishedAt ?? null,
        publishedByUserId: t.publishedByUserId ?? null,
        assignedAt: t.assignedAt ?? null,
        assignedByUserId: t.assignedByUserId ?? null,
        assignedDriverUserId: t.assignedDriverUserId ?? null,
        assignedDriverName: null,
        driverId: t.driverId ?? null,
        driverName: null,
        vehicleType: null,
        customerCompanyName: j.customerCompany?.name ?? null,
        contactName: j.receiverName ?? null,
        contactPhone: j.receiverPhone ?? null,
        tripPICName: t.tripPICName ?? null,
        tripPICContact: t.tripPICContact ?? null,
        containerNumber: t.containerNumber ?? null,
        carrier: t.carrier ?? null,
        shipper: t.shipper ?? null,
        vessel: t.vessel ?? null,
        originSummary: null,
        destinationSummary: null,
        origin: null,
        destination: null,
        status: t.status,
        isPublished: t.status !== TripStatus.DRAFT,
        isCompleted:
          t.status === TripStatus.COMPLETED || t.status === TripStatus.DONE,
        pendingState: t.pendingState ?? TripPendingState.NONE,
        canPublish: evaluateTripPublishReadiness({
          status: t.status,
          assignedDriverUserId: t.assignedDriverUserId ?? null,
          driverId: t.driverId ?? null,
          vehicleId: t.vehicleId ?? null,
          fleetVehicleId: t.fleetVehicleId ?? null,
          driverEarningCents: t.driverEarningCents ?? null,
          payoutLines: t.payoutLines ?? [],
        }).canPublish,
        canMarkDone: t.status === TripStatus.COMPLETED,
        plannedStartAt: t.plannedStartAt ?? null,
        startedAt: t.startedAt ?? null,
        closedAt: t.closedAt ?? null,
        trailerNumber: t.trailerNumber ?? null,
        trailerLastLocationCode: t.trailerLastLocationCode ?? null,
        driverEarningCents: t.driverEarningCents ?? null,
        hasDriverPayout: Number.isInteger(t.driverEarningCents),
        earningLabelSnapshot: t.earningLabelSnapshot ?? null,
        earningRateMasterId: t.payoutItemId ?? t.earningRateMasterId ?? null,
        assignedVehicleId: t.fleetVehicleId ?? t.vehicleId ?? null,
        assignedVehiclePlateNo: null,
        liveTracking: {
          isTrackable: false,
          hasStarted: false,
          driverLat: null,
          driverLng: null,
          lastSeenAt: null,
          isStale: false,
          destinationLat: null,
          destinationLng: null,
        },
        payoutLines: [],
        driverEarningCentsTotal: t.driverEarningCents ?? null,
        documents: [],
        documentStatus: {
          pickupDo: "PENDING",
          deliveryDo: "GENERATED",
          podSignature: "PENDING",
          receiverDo: "PENDING",
        },
        completionRuleJson: t.completionRuleJson ?? null,
      })) ?? [],

    charges:
      j.charges?.map((c: any) => ({
        id: c.id,
        sourceType: c.sourceType,
        sourceRefId: c.sourceRefId ?? null,
        sourceCustomerQuotationItemId: c.sourceCustomerQuotationItemId ?? null,
        code: c.code,
        label: c.label,
        description: c.description ?? null,
        qty: c.qty,
        unitPriceCents: c.unitPriceCents,
        amountCents: c.amountCents,
        currency: c.currency,
        taxable: c.taxable,
        taxCode: c.taxCode ?? null,
        taxRateBasisPoints: c.taxRateBasisPoints ?? null,
        sortOrder: c.sortOrder,
        metadataJson: (c.metadataJson as Record<string, unknown> | null) ?? null,
      })) ?? [],
  };
}

function deriveTripDocumentStatus(documents: Array<any> | null | undefined): {
  pickupDo: "PENDING" | "UPLOADED";
  deliveryDo: "GENERATED" | "UPLOADED";
  podSignature: "PENDING" | "UPLOADED";
  receiverDo: "PENDING" | "UPLOADED";
} {
  const docs = documents ?? [];
  const hasPickupDo = docs.some((d) => d?.type === TripDocumentType.PICKUP_DO);
  const hasDeliveryDo = docs.some((d) => d?.type === TripDocumentType.DELIVERY_DO);
  const hasDeliveryDoGenerated = docs.some(
    (d) => d?.type === TripDocumentType.DELIVERY_DO && d?.generatedBySystem === true,
  );
  const hasPodSignature = docs.some((d) => d?.type === TripDocumentType.POD_SIGNATURE);
  const hasReceiverDo = docs.some((d) => d?.type === TripDocumentType.OTHER);
  return {
    pickupDo: hasPickupDo ? "UPLOADED" : "PENDING",
    deliveryDo: hasDeliveryDoGenerated || !hasDeliveryDo ? "GENERATED" : "UPLOADED",
    podSignature: hasPodSignature ? "UPLOADED" : "PENDING",
    receiverDo: hasReceiverDo ? "UPLOADED" : "PENDING",
  };
}

type TripPublishReadinessInput = {
  status: TripStatus;
  assignedDriverUserId?: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
  fleetVehicleId?: string | null;
  driverEarningCents?: number | null;
  payoutLines?: Array<any> | null;
};

type TripPublishReadinessResult = {
  canPublish: boolean;
  errorMessage: string | null;
  totalPayoutCents: number;
  payoutLineCount: number;
};

type PublishRouteBlockedTrip = {
  tripId: string;
  tripDisplayRef: string;
  reason: string;
};

function payoutLineLabel(line: any): string {
  const label = String(line?.label ?? "").trim();
  return label.length > 0 ? label : "Manual line";
}

function payoutLineQuantity(line: any): number {
  const raw = Number(line?.quantity ?? 1);
  if (!Number.isFinite(raw)) return 0;
  return Math.floor(raw);
}

function computePublishPayoutTotal(payoutLines: Array<any>): number {
  return payoutLines.reduce((sum, line) => {
    const quantity = payoutLineQuantity(line);
    const amount = Number(line?.amountCents);
    const totalCents = Number(line?.totalCents);
    if (Number.isFinite(totalCents) && totalCents > 0) {
      return sum + totalCents;
    }
    if (Number.isFinite(amount) && amount > 0 && quantity > 0) {
      return sum + amount * quantity;
    }
    return sum;
  }, 0);
}

function evaluateTripPublishReadiness(input: TripPublishReadinessInput): TripPublishReadinessResult {
  if (input.status !== TripStatus.DRAFT) {
    return {
      canPublish: false,
      errorMessage: "Trip is already published or cannot be published from current status",
      totalPayoutCents: 0,
      payoutLineCount: 0,
    };
  }

  if (
    (!input.assignedDriverUserId && !input.driverId) ||
    (!input.vehicleId && !input.fleetVehicleId)
  ) {
    return {
      canPublish: false,
      errorMessage: "Assign driver before publishing trip.",
      totalPayoutCents: 0,
      payoutLineCount: 0,
    };
  }

  const payoutLines = Array.isArray(input.payoutLines) ? input.payoutLines : [];
  if (payoutLines.length > 0) {
    const invalidManualAmount = payoutLines.find((line) => {
      const amount = Number(line?.amountCents);
      return !Number.isFinite(amount) || amount <= 0;
    });
    if (invalidManualAmount) {
      return {
        canPublish: false,
        errorMessage: `Payout line "${payoutLineLabel(invalidManualAmount)}" requires manual amount before publish`,
        totalPayoutCents: 0,
        payoutLineCount: payoutLines.length,
      };
    }

    const invalidManualLabel = payoutLines.find((line) => {
      const isManual = line?.isManual === true;
      return isManual && String(line?.label ?? "").trim().length === 0;
    });
    if (invalidManualLabel) {
      return {
        canPublish: false,
        errorMessage: "Manual payout line label is required before publish",
        totalPayoutCents: 0,
        payoutLineCount: payoutLines.length,
      };
    }

    const invalidManualQuantity = payoutLines.find((line) => {
      const isManual = line?.isManual === true;
      return isManual && payoutLineQuantity(line) <= 0;
    });
    if (invalidManualQuantity) {
      return {
        canPublish: false,
        errorMessage: `Payout line "${payoutLineLabel(invalidManualQuantity)}" quantity must be greater than 0 before publish`,
        totalPayoutCents: 0,
        payoutLineCount: payoutLines.length,
      };
    }

    const invalidManualTotal = payoutLines.find((line) => {
      const isManual = line?.isManual === true;
      const total = Number(line?.totalCents);
      return isManual && (!Number.isFinite(total) || total <= 0);
    });
    if (invalidManualTotal) {
      return {
        canPublish: false,
        errorMessage: `Payout line "${payoutLineLabel(invalidManualTotal)}" total must be greater than 0 before publish`,
        totalPayoutCents: 0,
        payoutLineCount: payoutLines.length,
      };
    }

    const total = computePublishPayoutTotal(payoutLines);
    if (total <= 0) {
      return {
        canPublish: false,
        errorMessage: "Driver payout total must be greater than 0 before publish",
        totalPayoutCents: 0,
        payoutLineCount: payoutLines.length,
      };
    }

    return {
      canPublish: true,
      errorMessage: null,
      totalPayoutCents: total,
      payoutLineCount: payoutLines.length,
    };
  }

  if (!Number.isInteger(input.driverEarningCents) || (input.driverEarningCents ?? 0) <= 0) {
    return {
      canPublish: false,
      errorMessage: "Set driver payout before publishing trip.",
      totalPayoutCents: 0,
      payoutLineCount: 0,
    };
  }

  return {
    canPublish: true,
    errorMessage: null,
    totalPayoutCents: input.driverEarningCents ?? 0,
    payoutLineCount: 0,
  };
}

function isPlanningEligibleStatus(status: TripStatus): boolean {
  return status === TripStatus.DRAFT || status === TripStatus.PUBLISHED;
}

function isTerminalStatus(status: TripStatus): boolean {
  return (
    status === TripStatus.COMPLETED
    || status === TripStatus.DONE
    || status === TripStatus.CANCELLED
  );
}

function firstNonEmptyText(...values: Array<unknown>): string | null {
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return null;
}

function deriveTripRouteSummaryFromJobAndTemplate(job: any, trip: any): {
  fromLabel: string | null;
  toLabel: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  fromType: string | null;
  toType: string | null;
} {
  const snapshotOriginLabel = firstNonEmptyText(
    trip?.originLabel,
    trip?.originAddressLine1,
    trip?.originAddressLine2,
    trip?.originPostalCode,
  );
  const snapshotDestinationLabel = firstNonEmptyText(
    trip?.destinationLabel,
    trip?.destinationAddressLine1,
    trip?.destinationAddressLine2,
    trip?.destinationPostalCode,
  );
  if (snapshotOriginLabel || snapshotDestinationLabel) {
    const payoutLines = (trip.payoutLines ?? []).map((line: any) => ({
      id: line.id,
      sourceRateMasterItemId: line.payoutItemId ?? null,
      code: line.code ?? null,
      label: line.label,
      description: line.description ?? null,
      unit: line.unit ?? null,
      quantity: line.quantity ?? 1,
      amountCents: line.amountCents ?? null,
      totalCents:
        line.totalCents ?? ((line.amountCents ?? null) != null ? (line.quantity ?? 1) * line.amountCents : null),
      notes: line.notes ?? null,
      isManual: line.isManual ?? false,
    }));
    return {
      fromLabel: snapshotOriginLabel,
      toLabel: snapshotDestinationLabel,
      fromAddress: firstNonEmptyText(
        trip?.originAddressLine1,
        trip?.originAddressLine2,
        trip?.originPostalCode,
      ),
      toAddress: firstNonEmptyText(
        trip?.destinationAddressLine1,
        trip?.destinationAddressLine2,
        trip?.destinationPostalCode,
      ),
      fromType: trip?.originLocationId ? "MASTER" : null,
      toType: trip?.destinationLocationId ? "MASTER" : null,
    };
  }

  const pickupAddress = firstNonEmptyText(job?.pickupAddress1, job?.pickupAddress2, job?.pickupPostal);
  const deliveryAddress = firstNonEmptyText(
    job?.deliveryAddress1,
    job?.deliveryAddress2,
    job?.deliveryPostal,
  );
  const portLabel = firstNonEmptyText(job?.portName, job?.pickupPortCode, job?.exportPortCode);
  const exportDepotLabel = firstNonEmptyText(job?.exportOriginDepotCode);
  const returnDepotLabel = firstNonEmptyText(job?.returningDepotCode);

  const t = trip?.jobTripTemplate as JobTripTemplate | null | undefined;
  switch (t) {
    case JobTripTemplate.PICKUP_TO_DELIVERY:
      return {
        fromLabel: pickupAddress ?? "Pickup location",
        toLabel: deliveryAddress ?? "Delivery location",
        fromAddress: pickupAddress,
        toAddress: deliveryAddress,
        fromType: "PICKUP",
        toType: "DELIVERY",
      };
    case JobTripTemplate.DELIVERY_TO_DEPOT:
      return {
        fromLabel: deliveryAddress ?? "Delivery location",
        toLabel: returnDepotLabel ?? "Return depot",
        fromAddress: deliveryAddress,
        toAddress: returnDepotLabel,
        fromType: "DELIVERY",
        toType: "DEPOT",
      };
    case JobTripTemplate.DEPOT_TO_DELIVERY:
      return {
        fromLabel: exportDepotLabel ?? "Origin depot",
        toLabel: deliveryAddress ?? "Delivery location",
        fromAddress: exportDepotLabel,
        toAddress: deliveryAddress,
        fromType: "DEPOT",
        toType: "DELIVERY",
      };
    case JobTripTemplate.DELIVERY_TO_PORT:
      return {
        fromLabel: deliveryAddress ?? "Delivery location",
        toLabel: portLabel ?? "Port",
        fromAddress: deliveryAddress,
        toAddress: portLabel,
        fromType: "DELIVERY",
        toType: "PORT",
      };
    default:
      return {
        fromLabel: pickupAddress,
        toLabel: deliveryAddress,
        fromAddress: pickupAddress,
        toAddress: deliveryAddress,
        fromType: pickupAddress ? "PICKUP" : null,
        toType: deliveryAddress ? "DELIVERY" : null,
      };
  }
}

function toTripLocationDto(prefix: "origin" | "destination", trip: any) {
  const label = trip?.[`${prefix}Label`] ?? null;
  const addressLine1 = trip?.[`${prefix}AddressLine1`] ?? null;
  const addressLine2 = trip?.[`${prefix}AddressLine2`] ?? null;
  const postalCode = trip?.[`${prefix}PostalCode`] ?? null;
  const country = trip?.[`${prefix}Country`] ?? null;
  const lat = trip?.[`${prefix}Lat`] ?? null;
  const lng = trip?.[`${prefix}Lng`] ?? null;
  const placeId = trip?.[`${prefix}PlaceId`] ?? null;
  const locationId = trip?.[`${prefix}LocationId`] ?? null;
  if (!label && !addressLine1 && !postalCode && lat == null && lng == null && !locationId) {
    return null;
  }
  return {
    label,
    addressLine1,
    addressLine2,
    postalCode,
    country,
    lat,
    lng,
    placeId,
    locationId,
  };
}

@Injectable()
export class OpsJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly supabaseService: SupabaseService,
  ) {}

  private getCustomerCompanyIdOrThrow(user: any): string {
    if (user?.role !== Role.CUSTOMER) {
      throw new ForbiddenException("Access denied");
    }
    const customerCompanyId = user?.customerCompanyId;
    if (!customerCompanyId) {
      throw new ForbiddenException(
        "CUSTOMER user is missing customerCompanyId",
      );
    }
    return customerCompanyId;
  }

  applyJobAccessFilter(tenantId: string, user: any): any {
    const where: any = { tenantId };
    if (user?.role === Role.CUSTOMER) {
      where.customerCompanyId = this.getCustomerCompanyIdOrThrow(user);
    }
    return where;
  }

  assertCanAccessJob(job: any, user: any) {
    if (user?.role !== Role.CUSTOMER) return;
    const customerCompanyId = this.getCustomerCompanyIdOrThrow(user);
    if (job?.customerCompanyId !== customerCompanyId) {
      throw new ForbiddenException("Not allowed to access this job");
    }
  }

  private async buildUserNameMapByIds(
    tenantId: string,
    userIds: string[],
  ): Promise<Map<string, string>> {
    const ids = Array.from(new Set(userIds.filter(Boolean)));
    if (!ids.length) return new Map<string, string>();
    const members = await this.prisma.tenantMembership.findMany({
      where: { tenantId, userId: { in: ids }, status: MembershipStatus.Active },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    const map = new Map<string, string>();
    for (const m of members) {
      const name = m.user?.name?.trim() || m.user?.email || null;
      if (!name) continue;
      map.set(m.userId, name);
    }
    return map;
  }

  private async attachTripAssignedDriverNamesForJobs(
    tenantId: string,
    jobs: JobDto[],
  ): Promise<void> {
    const ids: string[] = [];
    const tripIds: string[] = [];
    for (const job of jobs) {
      for (const trip of job.trips ?? []) {
        if (trip.assignedDriverUserId) ids.push(trip.assignedDriverUserId);
        if (trip.updatedByUserId) ids.push(trip.updatedByUserId);
        if (trip.assignedByUserId) ids.push(trip.assignedByUserId);
        if (trip.id) tripIds.push(trip.id);
      }
    }
    const nameMap = await this.buildUserNameMapByIds(tenantId, ids);
    const uniqueTripIds = Array.from(new Set(tripIds));
    const tripMetaList = uniqueTripIds.length
      ? await this.prisma.trip.findMany({
          where: { tenantId, id: { in: uniqueTripIds } },
          select: {
            id: true,
            driverId: true,
            createdByUserId: true,
            updatedByUserId: true,
            publishedAt: true,
            publishedByUserId: true,
            assignedAt: true,
            assignedByUserId: true,
            vehicleId: true,
            fleetVehicleId: true,
            documents: {
              where: {
                isActive: true,
                type: {
                  in: [
                    TripDocumentType.PICKUP_DO,
                    TripDocumentType.DELIVERY_DO,
                    TripDocumentType.POD_SIGNATURE,
                    TripDocumentType.OTHER,
                  ],
                },
              },
              select: { type: true, generatedBySystem: true },
            },
            vehicles: { select: { type: true } },
            fleetVehicle: { select: { type: true } },
          },
        })
      : [];
    const tripMetaMap = new Map<string, any>(
      tripMetaList.map((t) => [t.id, t] as [string, any]),
    );
    for (const job of jobs) {
      for (const trip of job.trips ?? []) {
        const tripMeta = tripMetaMap.get(trip.id);
        trip.assignedDriverName =
          (trip.assignedDriverUserId && nameMap.get(trip.assignedDriverUserId)) || null;
        trip.driverName = trip.assignedDriverName;
        trip.driverId = tripMeta?.driverId ?? trip.driverId ?? null;
        trip.vehicleType =
          tripMeta?.vehicles?.type ?? tripMeta?.fleetVehicle?.type ?? null;
        trip.createdByUserId = tripMeta?.createdByUserId ?? trip.createdByUserId ?? null;
        trip.updatedByUserId = tripMeta?.updatedByUserId ?? trip.updatedByUserId ?? null;
        trip.updatedByName =
          (trip.updatedByUserId && nameMap.get(trip.updatedByUserId)) || null;
        trip.publishedAt = tripMeta?.publishedAt ?? trip.publishedAt ?? null;
        trip.publishedByUserId =
          tripMeta?.publishedByUserId ?? trip.publishedByUserId ?? null;
        trip.assignedAt = tripMeta?.assignedAt ?? trip.assignedAt ?? null;
        trip.assignedByUserId = tripMeta?.assignedByUserId ?? trip.assignedByUserId ?? null;
        trip.customerCompanyName = job.companyName ?? null;
        trip.contactName = job.receiverName ?? null;
        trip.contactPhone = job.receiverPhone ?? null;
        trip.documentStatus = deriveTripDocumentStatus(tripMeta?.documents);
      }
    }
  }

  private async resolveQuotationChargeLinesForCustomer(
    tenantId: string,
    _customerCompanyId: string,
  ): Promise<{ quotationLines: any[]; masterRateLines: any[] }> {
    const dataset = await this.prisma.masterRateDataset.findFirst({
      where: {
        tenantId,
        type: MasterRateDatasetType.QUOTATION,
        status: MasterRateDatasetStatus.ACTIVE,
      },
      orderBy: { versionNo: "desc" },
      select: { id: true },
    });
    if (!dataset) return { quotationLines: [], masterRateLines: [] };

    const rows = await this.prisma.masterRateDatasetRow.findMany({
      where: { tenantId, datasetId: dataset.id, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }],
    });
    return {
      quotationLines: rows.map((r) => ({ ...r, source: "TENANT_QUOTATION_DATASET" })),
      masterRateLines: [],
    };
  }

  private async persistJobCharges(
    tenantId: string,
    jobId: string,
    dto: SaveJobChargesDto,
    selectedByUserId: string | null,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.jobCharge.deleteMany({ where: { tenantId, jobId } });
      if (!dto.charges.length) return;

      const quotationRefIds = dto.charges
        .filter(
          (c) =>
            c.sourceType === JobChargeSourceType.CUSTOMER_QUOTATION &&
            typeof c.sourceRefId === "string" &&
            c.sourceRefId.trim().length > 0,
        )
        .map((c) => c.sourceRefId!.trim());

      const quotationItems: any[] = quotationRefIds.length
        ? await tx.masterRateDatasetRow.findMany({
            where: {
              tenantId,
              id: { in: [...new Set(quotationRefIds)] },
              isActive: true,
              dataset: {
                type: MasterRateDatasetType.QUOTATION,
                status: MasterRateDatasetStatus.ACTIVE,
              },
            },
          })
        : [];
      const quotationItemById = new Map<string, any>(
        quotationItems.map((q: any) => [q.id, q]),
      );

      for (const c of dto.charges) {
        if (
          c.sourceType !== JobChargeSourceType.CUSTOMER_QUOTATION ||
          !c.sourceRefId ||
          !quotationItemById.has(c.sourceRefId)
        ) {
          continue;
        }
        const item = quotationItemById.get(c.sourceRefId)!;
        if (
          item.requiresManualAmount &&
          (!Number.isInteger(c.unitPriceCents) || c.unitPriceCents <= 0)
        ) {
          throw new BadRequestException(
            `Manual amount is required for quotation item "${item.label}" before saving charges`,
          );
        }
      }

      await tx.jobCharge.createMany({
        data: dto.charges.map((c, i) => ({
          ...(c.sourceType === JobChargeSourceType.CUSTOMER_QUOTATION &&
          c.sourceRefId &&
          quotationItemById.has(c.sourceRefId)
            ? (() => {
                const item = quotationItemById.get(c.sourceRefId!)!;
                return {
                  sourceCustomerQuotationItemId: null,
                  code: item.code,
                  label: item.label,
                  description: item.description ?? null,
                  unitPriceCents: c.unitPriceCents,
                  amountCents: c.qty * c.unitPriceCents,
                  metadataJson: {
                    quotationSnapshot: {
                      sourceTenantQuotationItemId: item.id,
                      section: item.section ?? null,
                      code: item.code,
                      label: item.label,
                      description: item.description ?? null,
                      unit: item.unit ?? null,
                      selectedRateCents: c.unitPriceCents,
                      selectedAmountCents: c.qty * c.unitPriceCents,
                      notes: item.notes ?? null,
                      capturedAt: now.toISOString(),
                    },
                  } as Prisma.InputJsonValue,
                };
              })()
            : {
                sourceCustomerQuotationItemId: null,
                code: c.code,
                label: c.label,
                description: c.description ?? null,
                unitPriceCents: c.unitPriceCents,
                amountCents: c.qty * c.unitPriceCents,
                metadataJson: null,
              }),
          tenantId,
          jobId,
          sourceType: c.sourceType,
          sourceRefId: c.sourceRefId ?? null,
          qty: c.qty,
          currency: c.currency ?? "SGD",
          taxable: c.taxable ?? true,
          taxCode: c.taxCode ?? null,
          taxRateBasisPoints: c.taxRateBasisPoints ?? null,
          sortOrder: c.sortOrder ?? i,
          selectedByUserId: selectedByUserId ?? null,
          overrideReason: c.overrideReason ?? null,
          updatedAt: now,
        })),
      });
    });

    await this.audit.log(
      tenantId,
      "JOB_CHARGE_UPDATE",
      "JOB",
      jobId,
      { lineCount: dto.charges.length },
      selectedByUserId,
    );
  }

  private assertCustomerCanOnlyRead(user: any) {
    if (user?.role !== Role.CUSTOMER && user?.role !== Role.FINANCE) return;
    if (user?.role === Role.CUSTOMER) {
      // Ensure we throw ForbiddenException when customerCompanyId is missing too.
      this.getCustomerCompanyIdOrThrow(user);
    }
    throw new ForbiddenException(
      `${user?.role} users are read-only for job and trip documents`,
    );
  }

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

    const signedUrl = error ? null : (data?.signedUrl ?? null);
    const isPodSignature = doc.type === TripDocumentType.POD_SIGNATURE;
    const fileDisplay = buildDocumentFileDisplayFields(doc);
    return {
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
      url: signedUrl,
      downloadUrl: signedUrl,
      previewUrl: signedUrl,
    };
  }

  private isAllowedTripDocument(file: Express.Multer.File): boolean {
    if (!file) return false;
    const name = String(file.originalname ?? "");
    const mime = String(file.mimetype ?? "").toLowerCase();
    return OTHER_JOB_DOC_EXT.test(name) || OTHER_JOB_DOC_MIMES.has(mime);
  }

  /** Upload bytes to the job-documents bucket (shared by quotation / OTHER / etc.). */
  private async putJobDocumentObject(
    storageKey: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase.storage
      .from(JOB_DOCUMENTS_BUCKET)
      .upload(storageKey, buffer, {
        contentType,
        upsert: false,
      });

    if (error) {
      throw new BadRequestException(`Storage upload failed: ${error.message}`);
    }
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
        isActive: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  private async deleteStorageObjectIfExists(
    storageKey: string | null | undefined,
  ) {
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
        isActive: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!existingDocs.length) return null;

    await this.prisma.jobDocument.updateMany({
      where: {
        tenantId,
        jobId,
        type,
        isActive: true,
      },
      data: { isActive: false },
    });

    return existingDocs[0] ?? null;
  }

  private async replaceTripDocumentByType(
    tenantId: string,
    tripId: string,
    type: TripDocumentType,
    onlyGenerated = false,
  ) {
    const existingDocs = await this.prisma.tripDocument.findMany({
      where: {
        tenantId,
        tripId,
        type,
        isActive: true,
        ...(onlyGenerated ? { generatedBySystem: true } : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!existingDocs.length) return null;

    await this.prisma.tripDocument.updateMany({
      where: {
        tenantId,
        tripId,
        type,
        isActive: true,
        ...(onlyGenerated ? { generatedBySystem: true } : {}),
      },
      data: { isActive: false },
    });

    return existingDocs[0] ?? null;
  }

  private async getActiveLogisticsLocationById(
    locationId: string | null | undefined,
  ) {
    if (!locationId) return null;
    return this.prisma.masterLogisticsLocation.findFirst({
      where: { id: locationId, isActive: true },
    });
  }

  private async resolveLogisticsCodeFromId(
    locationId: string | null | undefined,
    type: LogisticsLocationType,
  ): Promise<string | null> {
    if (!locationId) return null;
    const row = await this.prisma.masterLogisticsLocation.findFirst({
      where: { id: locationId, type, isActive: true },
      select: { code: true },
    });
    return row?.code ?? null;
  }

  private locationSnapshotFromMaster(master: any) {
    if (!master) return null;
    return {
      locationId: master.id,
      label: `${master.code} — ${master.name}`,
      addressLine1: master.addressLine1 ?? null,
      addressLine2: master.addressLine2 ?? null,
      postalCode: master.postalCode ?? null,
      country: master.country ?? "SG",
      lat: master.lat ?? null,
      lng: master.lng ?? null,
      placeId: master.placeId ?? null,
      locationType: master.type ?? null,
    };
  }

  private buildAddressSnapshot(
    label: string | null,
    job: any,
    prefix: "pickup" | "delivery",
    geo?: { lat?: number | null; lng?: number | null; placeId?: string | null },
  ) {
    return {
      locationId: null,
      label,
      addressLine1: job?.[`${prefix}Address1`] ?? null,
      addressLine2: job?.[`${prefix}Address2`] ?? null,
      postalCode: job?.[`${prefix}Postal`] ?? null,
      country: "SG",
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      placeId: geo?.placeId ?? null,
      locationType: prefix === "pickup" ? "PICKUP" : "DELIVERY",
    };
  }

  private async syncTripRouteSnapshotForJob(
    tenantId: string,
    jobId: string,
    options?: { deliveryLat?: number | null; deliveryLng?: number | null; deliveryPlaceId?: string | null },
  ): Promise<void> {
    if (
      !(this.prisma as any).job?.findFirst ||
      !(this.prisma as any).trip?.update
    ) {
      return;
    }
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      include: { trips: { orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }] } },
    });
    if (!job) return;
    const [pickupPort, returnDepot, exportPort, exportOriginDepot] = await Promise.all([
      (this.prisma as any).masterLogisticsLocation && job.pickupPortCode
        ? this.prisma.masterLogisticsLocation.findFirst({
            where: { isActive: true, type: LogisticsLocationType.PORT, code: job.pickupPortCode },
          })
        : Promise.resolve(null),
      (this.prisma as any).masterLogisticsLocation && job.returningDepotCode
        ? this.prisma.masterLogisticsLocation.findFirst({
            where: { isActive: true, type: LogisticsLocationType.DEPOT, code: job.returningDepotCode },
          })
        : Promise.resolve(null),
      (this.prisma as any).masterLogisticsLocation && job.exportPortCode
        ? this.prisma.masterLogisticsLocation.findFirst({
            where: { isActive: true, type: LogisticsLocationType.PORT, code: job.exportPortCode },
          })
        : Promise.resolve(null),
      (this.prisma as any).masterLogisticsLocation && job.exportOriginDepotCode
        ? this.prisma.masterLogisticsLocation.findFirst({
            where: {
              isActive: true,
              type: LogisticsLocationType.DEPOT,
              code: job.exportOriginDepotCode,
            },
          })
        : Promise.resolve(null),
    ]);

    for (const trip of job.trips ?? []) {
      let origin: any = null;
      let destination: any = null;
      if (trip.jobTripTemplate === JobTripTemplate.PICKUP_TO_DELIVERY) {
        origin = this.locationSnapshotFromMaster(pickupPort);
        destination = this.buildAddressSnapshot(
          job.deliveryAddress1 ?? "Delivery location",
          job,
          "delivery",
          {
            lat: options?.deliveryLat ?? null,
            lng: options?.deliveryLng ?? null,
            placeId: options?.deliveryPlaceId ?? null,
          },
        );
      } else if (trip.jobTripTemplate === JobTripTemplate.DELIVERY_TO_DEPOT) {
        origin = this.buildAddressSnapshot(
          job.deliveryAddress1 ?? "Delivery location",
          job,
          "delivery",
          {
            lat: options?.deliveryLat ?? null,
            lng: options?.deliveryLng ?? null,
            placeId: options?.deliveryPlaceId ?? null,
          },
        );
        destination = this.locationSnapshotFromMaster(returnDepot);
      } else if (trip.jobTripTemplate === JobTripTemplate.DEPOT_TO_DELIVERY) {
        origin = this.locationSnapshotFromMaster(exportOriginDepot);
        destination = this.buildAddressSnapshot(
          job.deliveryAddress1 ?? "Stuffing destination",
          job,
          "delivery",
          {
            lat: options?.deliveryLat ?? null,
            lng: options?.deliveryLng ?? null,
            placeId: options?.deliveryPlaceId ?? null,
          },
        );
      } else if (trip.jobTripTemplate === JobTripTemplate.DELIVERY_TO_PORT) {
        origin = this.buildAddressSnapshot(
          job.deliveryAddress1 ?? "Stuffing destination",
          job,
          "delivery",
          {
            lat: options?.deliveryLat ?? null,
            lng: options?.deliveryLng ?? null,
            placeId: options?.deliveryPlaceId ?? null,
          },
        );
        destination = this.locationSnapshotFromMaster(exportPort);
      }
      await this.prisma.trip.update({
        where: { id: trip.id },
        data: {
          originLocationId: origin?.locationId ?? null,
          originLabel: origin?.label ?? null,
          originAddressLine1: origin?.addressLine1 ?? null,
          originAddressLine2: origin?.addressLine2 ?? null,
          originPostalCode: origin?.postalCode ?? null,
          originCountry: origin?.country ?? null,
          originLat: origin?.lat ?? null,
          originLng: origin?.lng ?? null,
          originPlaceId: origin?.placeId ?? null,
          destinationLocationId: destination?.locationId ?? null,
          destinationLabel: destination?.label ?? null,
          destinationAddressLine1: destination?.addressLine1 ?? null,
          destinationAddressLine2: destination?.addressLine2 ?? null,
          destinationPostalCode: destination?.postalCode ?? null,
          destinationCountry: destination?.country ?? null,
          destinationLat: destination?.lat ?? null,
          destinationLng: destination?.lng ?? null,
          destinationPlaceId: destination?.placeId ?? null,
        },
      });
    }
  }

  async list(
    tenantId: string,
    query: JobListQueryDto,
    user: any,
  ): Promise<PaginatedResponse<JobDto>> {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query);

    const where: any = this.applyJobAccessFilter(tenantId, user);

    if (query.status) {
      where.status = query.status as JobStatus;
    }

    // CUSTOMER users can't choose other customerCompanyIds.
    if (query.companyId && user?.role !== Role.CUSTOMER) {
      where.customerCompanyId = query.companyId;
    }

    const day = query.date?.trim();
    const from = query.dateFrom?.trim() || query.pickupDateFrom?.trim();
    const to = query.dateTo?.trim() || query.pickupDateTo?.trim();

    if (day) {
      const dayStart = new Date(day + "T00:00:00.000Z");
      const dayEnd = new Date(day + "T23:59:59.999Z");
      where.OR = [
        { pickupDate: { gte: dayStart, lte: dayEnd } },
        {
          trips: {
            some: {
              plannedStartAt: { gte: dayStart, lte: dayEnd },
            },
          },
        },
      ];
    } else if (from || to) {
      const pickupRange: any = {};
      const tripRange: any = {};
      if (from) {
        const gte = new Date(from + "T00:00:00.000Z");
        pickupRange.gte = gte;
        tripRange.gte = gte;
      }
      if (to) {
        const lte = new Date(to + "T23:59:59.999Z");
        pickupRange.lte = lte;
        tripRange.lte = lte;
      }
      where.OR = [
        { pickupDate: pickupRange },
        { trips: { some: { plannedStartAt: tripRange } } },
      ];
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
      ONGOING: { status: JobStatus.ONGOING },
      READY_FOR_INVOICE: { status: JobStatus.READY_FOR_INVOICE },
      COMPLETED: { status: JobStatus.COMPLETED },
      CANCELLED: { status: JobStatus.CANCELLED },
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
        "startedAt",
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
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          items: {
            orderBy: { createdAt: "asc" },
          },
          trips: {
            orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              createdAt: true,
              assignedDriverUserId: true,
              jobSequence: true,
              jobTripTemplate: true,
              title: true,
              tripPICName: true,
              tripPICContact: true,
              containerNumber: true,
              carrier: true,
              shipper: true,
              vessel: true,
              status: true,
              plannedStartAt: true,
              startedAt: true,
              closedAt: true,
              trailerNumber: true,
              trailerLastLocationCode: true,
              driverEarningCents: true,
              earningLabelSnapshot: true,
              earningRateMasterId: true,
            },
          },
        },
      }),
    ]);

    const jobDtos = jobs.map(toJobDto);
    await this.attachTripAssignedDriverNamesForJobs(tenantId, jobDtos);

    return {
      data: jobDtos,
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async create(
    tenantId: string,
    dto: CreateJobDto,
    user: any,
  ): Promise<JobDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
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

    const importDetails = (dto as any).importDetails ?? {};
    const exportDetails = (dto as any).exportDetails ?? {};
    const pickupPortId = importDetails.pickupPortId?.trim();
    const returningDepotId = importDetails.returningDepotId?.trim();
    const pickupPortCodeInput = (
      dto.pickupPortCode ?? importDetails.pickupPortCode
    )?.trim();
    const pickupPortCode =
      pickupPortCodeInput ??
      (await this.resolveLogisticsCodeFromId(
        pickupPortId,
        LogisticsLocationType.PORT,
      ));
    const portTerminalCode = (
      dto.portTerminalCode ?? importDetails.portTerminalCode
    )?.trim();
    const portName = (dto.portName ?? importDetails.portName)?.trim();
    const psaStorageRentLastDay =
      dto.psaStorageRentLastDay ?? importDetails.psaStorageRentLastDay;
    const vesselName = (dto.vesselName ?? importDetails.vesselName)?.trim();
    const vesselEta = dto.vesselEta ?? importDetails.vesselEta;
    const portnetReady =
      dto.portnetReady ?? importDetails.portnetReady ?? false;
    const permitReady = dto.permitReady ?? importDetails.permitReady ?? false;
    const returningDepotCodeInput = (
      dto.returningDepotCode ??
      importDetails.returningDepotCode ??
      exportDetails.returnDepotCode
    )?.trim();
    const returningDepotCode =
      returningDepotCodeInput ??
      (await this.resolveLogisticsCodeFromId(
        returningDepotId,
        LogisticsLocationType.DEPOT,
      ));
    const returnLastDay =
      dto.returnLastDay ??
      importDetails.returnLastDay ??
      exportDetails.returnLastDay;
    const exportOriginDepotCode = (
      dto.exportOriginDepotCode ??
      exportDetails.pickupDepotCode ??
      exportDetails.exportOriginDepotCode
    )?.trim();
    const exportPortCode = (
      dto.exportPortCode ?? exportDetails.exportPortCode
    )?.trim();
    const containerPickupAddress1 = (
      exportDetails.containerPickupAddress1 ?? dto.pickupAddress1
    )?.trim();
    const containerPickupAddress2 = (
      exportDetails.containerPickupAddress2 ?? dto.pickupAddress2
    )?.trim();
    const containerPickupPostal = (
      exportDetails.containerPickupPostal ?? dto.pickupPostal
    )?.trim();
    const stuffingAddress1 = (
      exportDetails.stuffingAddress1 ?? dto.deliveryAddress1
    )?.trim();
    const stuffingAddress2 = (
      exportDetails.stuffingAddress2 ?? dto.deliveryAddress2
    )?.trim();
    const stuffingPostal = (
      exportDetails.stuffingPostal ?? dto.deliveryPostal
    )?.trim();
    const stuffingContactName = (
      exportDetails.stuffingContactName ?? dto.receiverName
    )?.trim();
    const stuffingContactPhone = (
      exportDetails.stuffingContactPhone ?? dto.receiverPhone
    )?.trim();

    if (dto.jobType === JobType.IMPORT) {
      const portCode = pickupPortCode;
      if (!portCode) {
        throw new BadRequestException(
          "pickupPortCode is required for IMPORT jobs (Singapore port master code)",
        );
      }
      if (!returningDepotCode) {
        throw new BadRequestException(
          "returningDepotCode is required for IMPORT jobs",
        );
      }
      const port = await this.prisma.masterLogisticsLocation.findFirst({
        where: { code: portCode, type: LogisticsLocationType.PORT, isActive: true },
      });
      if (!port) {
        throw new BadRequestException(`Unknown pickupPortCode: ${portCode}`);
      }
      const returnDepotForImport = await this.prisma.masterLogisticsLocation.findFirst({
        where: {
          code: returningDepotCode ?? "",
          type: LogisticsLocationType.DEPOT,
          isActive: true,
        },
      });
      if (!returnDepotForImport) {
        throw new BadRequestException(
          `Unknown returningDepotCode: ${returningDepotCode}`,
        );
      }
    }

    if (dto.jobType === JobType.EXPORT) {
      if (!exportOriginDepotCode) {
        throw new BadRequestException(
          "exportDetails.pickupDepotCode is required for EXPORT jobs",
        );
      }
      if (!stuffingAddress1) {
        throw new BadRequestException(
          "exportDetails.stuffingAddress1 is required for EXPORT jobs",
        );
      }
      if (!returningDepotCode) {
        throw new BadRequestException(
          "exportDetails.returnDepotCode is required for EXPORT jobs",
        );
      }

      const [pickupDepot, returnDepot] = await Promise.all([
        this.prisma.masterLogisticsLocation.findFirst({
          where: {
            code: exportOriginDepotCode,
            type: LogisticsLocationType.DEPOT,
            isActive: true,
          },
        }),
        this.prisma.masterLogisticsLocation.findFirst({
          where: {
            code: returningDepotCode,
            type: LogisticsLocationType.DEPOT,
            isActive: true,
          },
        }),
      ]);

      if (!pickupDepot) {
        throw new BadRequestException(
          `Unknown export pickup depot code: ${exportOriginDepotCode}`,
        );
      }
      if (!returnDepot) {
        throw new BadRequestException(
          `Unknown export return depot code: ${returningDepotCode}`,
        );
      }
    }

    const internalRef = await this.getNextInternalRef(tenantId, dto.jobType);

    const pickupDateParsed = dto.pickupDate ? new Date(dto.pickupDate) : null;

    const job = await this.prisma.job.create({
      data: {
        tenantId,
        customerCompanyId: dto.customerCompanyId,
        internalRef,
        externalRef: normalizeExternalRef(dto.externalRef),
        jobType: dto.jobType,
        status: JobStatus.ONGOING,
        notes: dto.notes ?? null,
        createdByUserId: actorUserId,
        pickupDate: pickupDateParsed,
        pickupAddress1:
          dto.jobType === JobType.EXPORT
            ? (containerPickupAddress1 ?? dto.pickupAddress1)
            : dto.pickupAddress1,
        pickupAddress2:
          dto.jobType === JobType.EXPORT
            ? (containerPickupAddress2 ?? null)
            : (dto.pickupAddress2 ?? null),
        pickupPostal:
          dto.jobType === JobType.EXPORT
            ? (containerPickupPostal ?? null)
            : (dto.pickupPostal ?? null),
        pickupContactName: dto.pickupContactName ?? null,
        pickupContactPhone: dto.pickupContactPhone ?? null,
        deliveryAddress1:
          dto.jobType === JobType.EXPORT
            ? (stuffingAddress1 ?? dto.deliveryAddress1)
            : dto.deliveryAddress1,
        deliveryAddress2:
          dto.jobType === JobType.EXPORT
            ? (stuffingAddress2 ?? null)
            : (dto.deliveryAddress2 ?? null),
        deliveryPostal:
          dto.jobType === JobType.EXPORT
            ? (stuffingPostal ?? null)
            : (dto.deliveryPostal ?? null),
        receiverName:
          dto.jobType === JobType.EXPORT
            ? (stuffingContactName ?? dto.receiverName)
            : dto.receiverName,
        receiverPhone:
          dto.jobType === JobType.EXPORT
            ? (stuffingContactPhone ?? dto.receiverPhone)
            : dto.receiverPhone,
        pickupPortCode: pickupPortCode || null,
        portTerminalCode: portTerminalCode || null,
        portName: portName || null,
        psaStorageRentLastDay: psaStorageRentLastDay
          ? new Date(psaStorageRentLastDay)
          : null,
        vesselName: vesselName || null,
        vesselEta: vesselEta ? new Date(vesselEta) : null,
        portnetReady,
        permitReady,
        returningDepotCode: returningDepotCode || null,
        returnLastDay: returnLastDay ? new Date(returnLastDay) : null,
        exportOriginDepotCode: exportOriginDepotCode || null,
        exportPortCode: exportPortCode || null,
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
      {
        internalRef: job.internalRef,
        externalRef: job.externalRef,
        createdByUserId: actorUserId,
      },
      actorUserId,
    );

    // Cargo/shipping defaults are applied inside tripCreateManyForJob only for IMPORT/EXPORT; LCL legs are skipped.
    const seededContainerNumber = String(dto.containerNumber ?? "").trim() || null;
    const seededShippingRefs = {
      carrier: null,
      shipper: null,
      vessel: String((job as any)?.vesselName ?? "").trim() || null,
    };
    await this.prisma.trip.createMany({
      data: tripCreateManyForJob(
        tenantId,
        job.id,
        dto.jobType,
        pickupDateParsed,
        seededContainerNumber,
        seededShippingRefs,
        undefined,
        actorUserId,
      ),
    });
    const createdTrips = await this.prisma.trip.findMany({
      where: { tenantId, jobId: job.id },
      orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if ((this.prisma as any).masterLogisticsLocation) {
      await this.syncTripRouteSnapshotForJob(tenantId, job.id, {
        deliveryLat: dto.deliveryLat ?? null,
        deliveryLng: dto.deliveryLng ?? null,
        deliveryPlaceId: dto.deliveryPlaceId ?? null,
      });
    }

    // Best-effort: auto-generate trip-level DELIVERY_DO for each created trip.
    // We do not fail whole job creation when document generation/storage fails.
    for (const trip of createdTrips) {
      try {
        await this.generateTripDeliveryDoDocument(
          tenantId,
          job.id,
          trip.id,
          user,
          "AUTO_CREATE_JOB",
        );
      } catch (error: any) {
        console.error(
          `[OpsJobsService] Auto-generate trip DELIVERY_DO failed for job ${job.id}, trip ${trip.id}:`,
          error?.message ?? error,
        );
      }
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
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        items: {
          orderBy: { createdAt: "asc" },
        },
        trips: {
          orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }],
          include: {
            payoutLines: {
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            },
          },
        },
        charges: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        documents: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!freshJob) {
      throw new NotFoundException("Job not found after creation");
    }

    const jobDto = toJobDto(freshJob);
    await this.attachTripAssignedDriverNamesForJobs(tenantId, [jobDto]);

    if (freshJob.documents?.length) {
      jobDto.documents = await Promise.all(
        freshJob.documents.map((doc: any) => this.attachSignedUrl(doc)),
      );
    }

    return jobDto;
  }

  async getOne(tenantId: string, jobId: string, user: any): Promise<JobDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      include: {
        customerCompany: {
          select: { id: true, name: true },
        },
        assignedDriver: {
          select: { id: true, name: true, email: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        items: {
          orderBy: { createdAt: "asc" },
        },
        trips: {
          orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }],
        },
        charges: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        documents: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!job) {
      throw new NotFoundException("Job not found");
    }

    this.assertCanAccessJob(job, user);

    const dto = toJobDto(job);
    await this.attachTripAssignedDriverNamesForJobs(tenantId, [dto]);

    // Best-effort: attach assigned plate number from either vehicle source.
    if (job.assignedVehicleId || job.assignedFleetVehicleId) {
      const [vehicle, fleetVehicle] = await Promise.all([
        job.assignedVehicleId
          ? this.prisma.vehicle.findFirst({
              where: { id: job.assignedVehicleId, tenantId },
              select: { plateNo: true },
            })
          : Promise.resolve(null),
        job.assignedFleetVehicleId
          ? this.prisma.fleetVehicle.findFirst({
              where: { id: job.assignedFleetVehicleId, tenantId },
              select: { plateNo: true },
            })
          : Promise.resolve(null),
      ]);
      dto.assignedVehiclePlateNo = vehicle?.plateNo ?? fleetVehicle?.plateNo ?? null;
    }

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
    user: any,
  ): Promise<JobDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) throw new NotFoundException("Job not found");

    if (
      job.status === JobStatus.COMPLETED ||
      job.status === JobStatus.CANCELLED
    ) {
      throw new BadRequestException(
        "Cannot edit job in COMPLETED or CANCELLED status",
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
    if (dto.pickupAddress1 !== undefined)
      data.pickupAddress1 = dto.pickupAddress1;
    if (dto.pickupAddress2 !== undefined)
      data.pickupAddress2 = dto.pickupAddress2;
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
    if (dto.deliveryPostal !== undefined)
      data.deliveryPostal = dto.deliveryPostal;
    if (dto.receiverName !== undefined) data.receiverName = dto.receiverName;
    if (dto.receiverPhone !== undefined) data.receiverPhone = dto.receiverPhone;
    if (dto.externalRef !== undefined) {
      data.externalRef = normalizeExternalRef(dto.externalRef);
    }

    if (dto.pickupPortCode !== undefined) {
      data.pickupPortCode = dto.pickupPortCode?.trim() || null;
    }
    if (dto.portTerminalCode !== undefined) {
      data.portTerminalCode = dto.portTerminalCode?.trim() || null;
    }
    if (dto.portName !== undefined) data.portName = dto.portName?.trim() || null;
    if (dto.psaStorageRentLastDay !== undefined) {
      data.psaStorageRentLastDay = dto.psaStorageRentLastDay
        ? new Date(dto.psaStorageRentLastDay)
        : null;
    }
    if (dto.vesselName !== undefined) {
      data.vesselName = dto.vesselName?.trim() || null;
    }
    if (dto.vesselEta !== undefined) {
      data.vesselEta = dto.vesselEta ? new Date(dto.vesselEta) : null;
    }
    if (dto.portnetReady !== undefined) data.portnetReady = dto.portnetReady;
    if (dto.permitReady !== undefined) data.permitReady = dto.permitReady;
    if (dto.returningDepotCode !== undefined) {
      data.returningDepotCode = dto.returningDepotCode?.trim() || null;
    }
    if (dto.returnLastDay !== undefined) {
      data.returnLastDay = dto.returnLastDay ? new Date(dto.returnLastDay) : null;
    }
    if (dto.exportOriginDepotCode !== undefined) {
      data.exportOriginDepotCode = dto.exportOriginDepotCode?.trim() || null;
    }
    if (dto.exportPortCode !== undefined) {
      data.exportPortCode = dto.exportPortCode?.trim() || null;
    }

    const inputItems = Array.isArray((dto as any).items)
      ? (dto as any).items
      : null;

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
      {
        changedFields: [...Object.keys(data), ...(inputItems ? ["items"] : [])],
      },
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
    user: any,
  ): Promise<JobDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) throw new NotFoundException("Job not found");

    if (job.status !== JobStatus.ONGOING) {
      throw new BadRequestException("Job must be ONGOING to assign");
    }

    if (job.startedAt) {
      throw new BadRequestException(
        "Cannot reassign job that has been started",
      );
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

    if (dto.vehicleId && dto.fleetVehicleId) {
      throw new BadRequestException(
        "Provide only one of vehicleId or fleetVehicleId",
      );
    }

    let vehicleId: string | null = dto.vehicleId ?? null;
    let fleetVehicleId: string | null = dto.fleetVehicleId ?? null;

    // If no vehicleId is provided, try to infer from driver
    if (!vehicleId && !fleetVehicleId) {
      const driver = await this.prisma.drivers.findFirst({
        where: { tenantId, userId: dto.driverId },
        select: { id: true, assignedVehicleId: true, assignedFleetVehicleId: true },
      });

      if (driver?.assignedVehicleId && driver?.assignedFleetVehicleId) {
        throw new BadRequestException(
          "Driver has inconsistent default assignment (both vehicle and fleet vehicle)",
        );
      }

      // Prefer explicit assignment pointers on drivers table.
      if (driver?.assignedVehicleId) {
        vehicleId = driver.assignedVehicleId;
      } else if (driver?.assignedFleetVehicleId) {
        fleetVehicleId = driver.assignedFleetVehicleId;
      } else {
        const [vehicleFromRelation, fleetVehicleFromRelation] =
          await this.prisma.$transaction([
            this.prisma.vehicle.findFirst({
              where: { tenantId, driverId: dto.driverId },
              select: { id: true },
            }),
            this.prisma.fleetVehicle.findFirst({
              where: { tenantId, driverId: dto.driverId },
              select: { id: true },
            }),
          ]);

        if (vehicleFromRelation) {
          vehicleId = vehicleFromRelation.id;

          if (driver) {
            await this.prisma.drivers.update({
              where: { id: driver.id },
              data: { assignedVehicleId: vehicleId, assignedFleetVehicleId: null },
            });
          }
        } else if (fleetVehicleFromRelation) {
          fleetVehicleId = fleetVehicleFromRelation.id;
          if (driver) {
            await this.prisma.drivers.update({
              where: { id: driver.id },
              data: { assignedVehicleId: null, assignedFleetVehicleId: fleetVehicleId },
            });
          }
        }
      }

      if (!vehicleId && !fleetVehicleId) {
        throw new BadRequestException(
          "Driver has no assigned vehicle or fleet vehicle; provide vehicleId or fleetVehicleId",
        );
      }
    }

    if (vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: vehicleId, tenantId },
      });
      if (!vehicle) throw new BadRequestException("Vehicle not found");
    }
    if (fleetVehicleId) {
      const fleetVehicle = await this.prisma.fleetVehicle.findFirst({
        where: { id: fleetVehicleId, tenantId },
      });
      if (!fleetVehicle) throw new BadRequestException("Fleet vehicle not found");
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        assignedDriverId: dto.driverId,
        assignedVehicleId: vehicleId,
        assignedFleetVehicleId: fleetVehicleId,
        assignedAt: new Date(),
        status: JobStatus.ONGOING,
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
      { driverId: dto.driverId, vehicleId, fleetVehicleId },
      actorUserId,
    );

    return toJobDto(updated);
  }

  async cancel(
    tenantId: string,
    jobId: string,
    dto: CancelJobDto,
    user: any,
  ): Promise<JobDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      select: {
        id: true,
        status: true,
        _count: { select: { trips: true } },
      },
    });

    if (!job) throw new NotFoundException("Job not found");

    if (job.status === JobStatus.COMPLETED) {
      throw new BadRequestException("Cannot cancel a COMPLETED job");
    }
    if ((job as any)._count?.trips > 0) {
      throw new BadRequestException(
        "This job has trips. Cancel trips individually from the Trips tab.",
      );
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.CANCELLED,
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

  async delete(tenantId: string, jobId: string, user: any): Promise<void> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      select: {
        id: true,
        status: true,
        startedAt: true,
        assignedDriverId: true,
        _count: { select: { trips: true } },
      },
    });

    if (!job) throw new NotFoundException("Job not found");

    if ((job as any)._count?.trips > 0) {
      throw new BadRequestException(
        "This job has trips. Delete or cancel the trips before deleting the job.",
      );
    }

    const canDelete =
      job.status === JobStatus.ONGOING &&
      !job.startedAt &&
      !job.assignedDriverId;

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
    user: any,
  ): Promise<JobDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) throw new NotFoundException("Job not found");

    if (job.jobType === JobType.LCL) {
      throw new BadRequestException(
        "Verify depot only applies to IMPORT/EXPORT jobs",
      );
    }

    if (job.status !== JobStatus.READY_FOR_INVOICE) {
      throw new BadRequestException("Job must be in READY_FOR_INVOICE status");
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
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
    user: any,
  ): Promise<JobDocumentDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
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

    await this.putJobDocumentObject(
      key,
      file.buffer,
      file.mimetype ?? "application/octet-stream",
    );

    const doc = await this.prisma.jobDocument.create({
      data: {
        tenantId,
        jobId,
        type: JobDocumentType.QUOTATION,
        isActive: true,
        storageKey: key,
        originalName: file.originalname ?? "quotation",
        mimeType: file.mimetype ?? "application/octet-stream",
        sizeBytes: file.size ?? null,
        uploadedByUserId: actorUserId ?? null,
        uploadedByNameSnapshot:
          user?.name?.trim() || user?.email?.trim() || null,
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

  private isAllowedOtherJobDocument(file: Express.Multer.File): boolean {
    const mime = String(file.mimetype ?? "").toLowerCase();
    const name = (file.originalname ?? "").toLowerCase();
    return OTHER_JOB_DOC_MIMES.has(mime) || OTHER_JOB_DOC_EXT.test(name);
  }

  async uploadOtherDocument(
    tenantId: string,
    jobId: string,
    file: Express.Multer.File,
    user: any,
  ): Promise<JobDocumentDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) throw new NotFoundException("Job not found");

    if (!this.isAllowedOtherJobDocument(file)) {
      throw new BadRequestException(
        "Unsupported file type for generic job document",
      );
    }

    const rawName = file.originalname ?? "document";
    const ext = rawName.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
    const base = this.safeFileName(rawName.replace(/\.[a-z0-9]+$/i, "")) || "file";
    const key = `${tenantId}/jobs/${jobId}/other/${Date.now()}-${base}${ext}`;

    await this.putJobDocumentObject(
      key,
      file.buffer,
      file.mimetype ?? "application/octet-stream",
    );

    const doc = await this.prisma.jobDocument.create({
      data: {
        tenantId,
        jobId,
        type: JobDocumentType.OTHER,
        isActive: true,
        storageKey: key,
        originalName: file.originalname ?? "document",
        mimeType: file.mimetype ?? "application/octet-stream",
        sizeBytes: file.size ?? null,
        uploadedByUserId: actorUserId ?? null,
        uploadedByNameSnapshot:
          user?.name?.trim() || user?.email?.trim() || null,
      },
    });

    await this.audit.log(
      tenantId,
      "UPLOAD_OTHER_DOC",
      "JOB",
      jobId,
      { documentId: doc.id, type: "OTHER" },
      actorUserId,
    );

    return this.attachSignedUrl(doc);
  }

  async generateTripDeliveryDoDocument(
    tenantId: string,
    jobId: string,
    tripId: string,
    user: any,
    source: "AUTO_CREATE_JOB" | "MANUAL_REGENERATE" = "MANUAL_REGENERATE",
  ) {
    this.assertCustomerCanOnlyRead(user);
    const userId: string | null = user?.userId ?? null;
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
      },
    });

    if (!job) {
      throw new NotFoundException("Job not found");
    }

    if (!job.items?.length) {
      throw new BadRequestException(
        "Add at least one item before generating DO",
      );
    }

    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
    });
    if (!trip) {
      throw new NotFoundException("Trip not found");
    }

    const previousDo = await this.replaceTripDocumentByType(
      tenantId,
      tripId,
      TripDocumentType.DELIVERY_DO,
    );

    const pdfBuffer = await this.buildDoPdfBuffer(job);

    const refForFile =
      job.externalRef?.trim() || job.internalRef?.trim() || job.id;

    const safeRef = this.safeFileName(refForFile);
    const fileName = `${safeRef}_delivery-do.pdf`;
    const storageKey = `${tenantId}/jobs/${jobId}/trips/${tripId}/delivery-do/${Date.now()}-${fileName}`;

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

    const uploadedByNameSnapshot =
      user?.name?.trim() || user?.email?.trim() || null;
    const doc = await this.prisma.tripDocument.create({
      data: {
        tenantId,
        tripId,
        type: TripDocumentType.DELIVERY_DO,
        storageKey,
        originalName: fileName,
        mimeType: "application/pdf",
        sizeBytes: pdfBuffer.length,
        uploadedByUserId: userId ?? null,
        uploadedByNameSnapshot,
        generatedBySystem: true,
        generatedSource: source,
      },
    });

    await this.audit.log(
      tenantId,
      previousDo ? "REPLACE_DOC" : "GENERATE_DOC",
      "TRIP",
      tripId,
      {
        documentId: doc.id,
        previousDocumentId: previousDo?.id ?? null,
        type: "DELIVERY_DO",
        storageKey,
        originalName: doc.originalName,
        generatedBySystem: true,
        generatedSource: source,
        scope: "TRIP",
        tripId,
        jobId,
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
    user: any,
  ): Promise<JobDocumentDto[]> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) throw new NotFoundException("Job not found");

    this.assertCanAccessJob(job, user);

    const docs = await this.prisma.jobDocument.findMany({
      where: {
        tenantId,
        jobId,
        isActive: true,
        type: { in: [JobDocumentType.QUOTATION, JobDocumentType.OTHER] },
      },
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(docs.map((doc) => this.attachSignedUrl(doc)));
  }

  async getAudit(
    tenantId: string,
    jobId: string,
    limit?: number,
    user?: any,
  ): Promise<AuditLogEntryDto[]> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) throw new NotFoundException("Job not found");

    this.assertCanAccessJob(job, user);

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

  async getActivity(tenantId: string, jobId: string, user: any) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });
    if (!job) throw new NotFoundException("Job not found");
    this.assertCanAccessJob(job, user);

    const trips = await this.prisma.trip.findMany({
      where: { tenantId, jobId },
      select: { id: true, tripSequence: true },
    });
    const tripIds = trips.map((t) => t.id);
    const tripSeqMap = new Map<string, number | null>(
      trips.map((t) => [t.id, t.tripSequence ?? null] as const),
    );

    const logs = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        OR: [
          { entityType: "JOB", entityId: jobId },
          ...(tripIds.length
            ? [{ entityType: "TRIP", entityId: { in: tripIds } }]
            : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const actorNameMap = await this.buildUserNameMapByIds(
      tenantId,
      logs.map((l) => l.actorUserId).filter(Boolean) as string[],
    );

    return logs.map((log) => {
      const metadata = (log.metadata as Record<string, any> | null) ?? {};
      const typeMap: Record<string, string> = {
        CREATE: "JOB_CREATED",
        UPDATE: "JOB_UPDATED",
        ASSIGN: "ASSIGNED",
        TRIP_CREATE: "TRIP_CREATED",
        TRIP_REORDER: "TRIP_REORDERED",
        TRIP_PUBLISH: "TRIP_PUBLISHED",
        SEND_TO_INVOICE: "SEND_TO_INVOICE",
        UPLOAD_DOC: "DOC_UPLOADED",
        REPLACE_DOC: "DOC_REPLACED",
        GENERATE_DOC: "DOC_GENERATED",
        TRIP_DOC_UPLOAD: "DOC_UPLOADED",
        TRIP_DOC_REPLACE: "DOC_REPLACED",
        TRIP_DOC_SIGN: "DOC_SIGNED",
      };
      const activityType = typeMap[log.action] ?? log.action;
      const isTripScope = log.entityType === "TRIP";
      const tripId = isTripScope ? log.entityId : (metadata.tripId ?? null);
      const documentType =
        (metadata.type as string | undefined) ??
        (metadata.documentType as string | undefined) ??
        null;

      const humanLabelByType: Record<string, string> = {
        PICKUP_DO: "Collection Docs",
        DELIVERY_DO: "Delivery DO",
        POD_SIGNATURE: "POD signature",
        POD_PHOTO: "POD photo",
        QUOTATION: "Quotation",
        OTHER: "Document",
      };
      const docLabel = documentType ? (humanLabelByType[documentType] ?? "Document") : "Document";
      const computedType =
        activityType === "DOC_GENERATED" && metadata.previousDocumentId
          ? "DOC_REGENERATED"
          : activityType;
      const labelMap: Record<string, string> = {
        DOC_UPLOADED: `${docLabel} uploaded`,
        DOC_REPLACED: `${docLabel} replaced`,
        DOC_GENERATED: `${docLabel} generated`,
        DOC_REGENERATED: `${docLabel} regenerated`,
        DOC_SIGNED: `${docLabel} signed`,
      };

      return {
        id: log.id,
        scope: isTripScope ? "TRIP" : "JOB",
        scopeId: isTripScope ? log.entityId : jobId,
        tripId,
        type: computedType,
        label: labelMap[computedType] ?? computedType.replaceAll("_", " "),
        documentType,
        documentId: (metadata.documentId as string | undefined) ?? null,
        fileName: (metadata.originalName as string | undefined) ?? null,
        tripSequence: tripId ? (tripSeqMap.get(tripId) ?? null) : null,
        actorUserId: log.actorUserId ?? null,
        actorName: log.actorUserId ? actorNameMap.get(log.actorUserId) ?? null : null,
        isSystem: !log.actorUserId,
        metadata,
        createdAt: log.createdAt.toISOString(),
      };
    });
  }

  async saveJobCharges(
    tenantId: string,
    jobId: string,
    dto: SaveJobChargesDto,
    user: any,
  ): Promise<JobDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });
    if (!job) throw new NotFoundException("Job not found");
    if (
      job.status === JobStatus.COMPLETED ||
      job.status === JobStatus.CANCELLED
    ) {
      throw new BadRequestException("Cannot edit charges on COMPLETED/CANCELLED job");
    }

    await this.persistJobCharges(tenantId, jobId, dto, actorUserId);
    return this.getOne(tenantId, jobId, user);
  }

  async getBillingChargeOptionsForJob(
    tenantId: string,
    jobId: string,
    user: any,
  ): Promise<{
    quotationLines: any[];
    dhcReferences: any[];
    existingSnapshot: any[];
  }> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      include: {
        charges: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    });
    if (!job) throw new NotFoundException("Job not found");
    this.assertCanAccessJob(job, user);

    const { quotationLines } = await this.resolveQuotationChargeLinesForCustomer(
      tenantId,
      job.customerCompanyId,
    );

    const dhcDataset = await this.prisma.masterRateDataset.findFirst({
      where: {
        tenantId,
        type: MasterRateDatasetType.DHC_RATES,
        status: MasterRateDatasetStatus.ACTIVE,
      },
      orderBy: { versionNo: "desc" },
      select: { id: true },
    });
    const dhcReferences = dhcDataset
      ? await this.prisma.masterRateDatasetRow.findMany({
          where: { tenantId, datasetId: dhcDataset.id, isActive: true },
          orderBy: { code: "asc" },
        })
      : [];

    return {
      quotationLines,
      dhcReferences,
      existingSnapshot: job.charges ?? [],
    };
  }

  async getAvailableChargesForJob(
    tenantId: string,
    jobId: string,
    user: any,
  ): Promise<{
    quotationLines: any[];
    dhcReferences: any[];
    existingSnapshot: any[];
  }> {
    return this.getBillingChargeOptionsForJob(tenantId, jobId, user);
  }

  async listDriverTripRateMasters(tenantId: string) {
    try {
      const dataset = await this.prisma.masterRateDataset.findFirst({
        where: {
          tenantId,
          type: MasterRateDatasetType.TRUCKING_RATES,
          status: MasterRateDatasetStatus.ACTIVE,
        },
        orderBy: { versionNo: "desc" },
        select: { id: true },
      });
      if (!dataset) return [];
      return await this.prisma.masterRateDatasetRow.findMany({
        where: { tenantId, datasetId: dataset.id, isActive: true },
        orderBy: { code: "asc" },
      });
    } catch {
      return [];
    }
  }

  async listDepotHandlingReferences(tenantId: string) {
    return this.prisma.depotHandlingReference.findMany({
      where: { tenantId, active: true },
      orderBy: { code: "asc" },
    });
  }

  private async findValidDriverPayoutItemById(
    tenantId: string,
    id: string,
  ) {
    return this.prisma.driverPayoutItem.findFirst({
      where: {
        id,
        tenantId,
        active: true,
        isSelectableForTripEarning: true,
        masterFile: {
          type: MasterFileType.DRIVER_PAYOUT,
          isActive: true,
          status: MasterFileStatus.PARSED,
        },
      },
    });
  }

  async appendTrip(
    tenantId: string,
    jobId: string,
    dto: AppendJobTripDto,
    user: any,
  ): Promise<JobDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      include: { trips: { select: { jobSequence: true } } },
    });
    if (!job) throw new NotFoundException("Job not found");
    if (
      job.status === JobStatus.COMPLETED ||
      job.status === JobStatus.CANCELLED
    ) {
      throw new BadRequestException("Cannot add trips to COMPLETED/CANCELLED job");
    }

    const maxSeq = Math.max(
      0,
      ...(job.trips ?? []).map((t: { jobSequence: number | null }) =>
        t.jobSequence ?? 0,
      ),
    );
    const nextSeq = maxSeq + 1;
    const normalizedTemplateRaw =
      dto.jobTripTemplate == null ? "" : String(dto.jobTripTemplate).trim();
    const normalizedTemplate = normalizedTemplateRaw.length
      ? (normalizedTemplateRaw as JobTripTemplate)
      : JobTripTemplate.CUSTOM;

    if (!Object.values(JobTripTemplate).includes(normalizedTemplate)) {
      throw new BadRequestException(
        `jobTripTemplate must be one of: ${Object.values(JobTripTemplate).join(", ")}`,
      );
    }

    if (dto.notes !== undefined && dto.notes !== null && String(dto.notes).trim().length > 0) {
      throw new BadRequestException(
        "Trip notes are not supported on create yet (Trip.notes column is missing). Save notes at job level or use a trip custom field endpoint.",
      );
    }

    const plannedStartAt = dto.plannedStartAt
      ? new Date(dto.plannedStartAt)
      : dto.plannedDate
        ? new Date(dto.plannedDate + "T00:00:00.000Z")
        : null;

    const hasInlinePayoutLines = Array.isArray(dto.payoutLines) && dto.payoutLines.length > 0;

    let payoutItemId: string | null = null;
    let driverEarningCents: number | null = null;
    let earningLabelSnapshot: string | null = null;
    if (
      !hasInlinePayoutLines &&
      dto.earningRateMasterId !== undefined &&
      dto.earningRateMasterId !== null
    ) {
      const master = await this.findValidDriverPayoutItemById(
        tenantId,
        dto.earningRateMasterId,
      );
      if (!master) {
        throw new BadRequestException("Driver trip rate master not found");
      }
      const resolvedAmountCents = master.rateCents ?? null;
      if (master.requiresManualAmount || resolvedAmountCents == null) {
        throw new BadRequestException(
          `Selected payout item "${master.label}" requires manual amount before assignment`,
        );
      }
      payoutItemId = master.id;
      driverEarningCents = resolvedAmountCents;
      earningLabelSnapshot = master.label;
    }

    const trip = await this.prisma.trip.create({
      data: {
        tenantId,
        jobId,
        jobSequence: nextSeq,
        tripSequence: nextSeq,
        jobTripTemplate: normalizedTemplate,
        title: dto.title?.trim() || normalizedTemplate,
        displayTitle: dto.title?.trim() || normalizedTemplate,
        tripPICName: dto.tripPICName?.trim() || null,
        tripPICContact: dto.tripPICContact?.trim() || null,
        containerNumber: dto.containerNumber?.trim() || null,
        carrier: dto.carrier?.trim() || null,
        shipper: dto.shipper?.trim() || null,
        vessel: dto.vessel?.trim() || null,
        plannedStartAt,
        originLabel: dto.originSummary?.trim() || null,
        destinationLabel: dto.destinationSummary?.trim() || null,
        originPostalCode: dto.originPostalCode?.trim() || null,
        destinationPostalCode: dto.destinationPostalCode?.trim() || null,
        originPlaceId: dto.originPlaceId?.trim() || null,
        destinationPlaceId: dto.destinationPlaceId?.trim() || null,
        originLat: dto.originLat ?? null,
        originLng: dto.originLng ?? null,
        destinationLat: dto.destinationLat ?? null,
        destinationLng: dto.destinationLng ?? null,
        payoutItemId,
        earningRateMasterId: null,
        driverEarningCents,
        earningLabelSnapshot,
        status: TripStatus.DRAFT,
        pendingState: TripPendingState.NONE,
        createdByUserId: actorUserId,
        completionRuleJson: completionRuleForTemplate(normalizedTemplate),
      },
    });

    if (hasInlinePayoutLines) {
      try {
        await this.saveTripPayoutDraft(
          tenantId,
          jobId,
          trip.id,
          {
            earningRateMasterId: dto.earningRateMasterId ?? null,
            payoutLines: (dto.payoutLines ?? []) as any,
          },
          user,
        );
      } catch (error) {
        // Keep create-with-payout behavior effectively atomic for clients.
        try {
          await this.prisma.trip.delete({ where: { id: trip.id } });
        } catch {
          // Best-effort cleanup only.
        }
        throw error;
      }
    }

    await this.audit.log(
      tenantId,
      "TRIP_CREATE",
      "JOB",
      jobId,
      {
        tripId: trip.id,
        jobSequence: nextSeq,
        jobTripTemplate: normalizedTemplate,
        earningRateMasterId: dto.earningRateMasterId ?? null,
      },
      actorUserId,
    );

    await this.recalculateJobStatusFromTrips(tenantId, jobId);

    return this.getOne(tenantId, jobId, user);
  }

  async deleteTrip(
    tenantId: string,
    jobId: string,
    tripId: string,
    user: any,
  ): Promise<{ success: true; mode: "deleted" | "cancelled"; tripId: string; status?: TripStatus }> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;

    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
      select: {
        id: true,
        status: true,
        jobSequence: true,
        tripSequence: true,
        assignedDriverUserId: true,
        startedAt: true,
        closedAt: true,
        documents: { select: { id: true }, take: 1 },
        payoutLines: { select: { id: true }, take: 1 },
      },
    });
    if (!trip) throw new NotFoundException("Trip not found");

    if (trip.status === TripStatus.COMPLETED || trip.status === TripStatus.DONE) {
      throw new BadRequestException("Trips with status COMPLETED or DONE cannot be deleted.");
    }

    const hasOperationalHistory =
      !!trip.assignedDriverUserId ||
      !!trip.startedAt ||
      !!trip.closedAt ||
      (trip.documents?.length ?? 0) > 0 ||
      (trip.payoutLines?.length ?? 0) > 0;

    if (trip.status === TripStatus.DRAFT && !hasOperationalHistory) {
      await this.prisma.$transaction(async (tx) => {
        await tx.trip.delete({ where: { id: tripId } });
        const remaining = await tx.trip.findMany({
          where: { tenantId, jobId },
          orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }],
          select: { id: true },
        });
        for (let i = 0; i < remaining.length; i += 1) {
          const seq = i + 1;
          await tx.trip.update({
            where: { id: remaining[i].id },
            data: { tripSequence: seq, jobSequence: seq },
          });
        }
      });
      await this.audit.log(
        tenantId,
        "TRIP_DELETED",
        "TRIP",
        tripId,
        { jobId, oldStatus: trip.status, deletedByUserId: actorUserId },
        actorUserId,
      );
      await this.recalculateJobStatusFromTrips(tenantId, jobId);
      return { success: true, mode: "deleted", tripId };
    }

    if (trip.status !== TripStatus.CANCELLED) {
      await this.prisma.trip.update({
        where: { id: tripId },
        data: {
          status: TripStatus.CANCELLED,
          updatedByUserId: actorUserId,
        },
      });
      await this.audit.log(
        tenantId,
        "TRIP_CANCELLED",
        "TRIP",
        tripId,
        { jobId, oldStatus: trip.status, cancelledByUserId: actorUserId, reason: "Deleted by ops" },
        actorUserId,
      );
      await this.recalculateJobStatusFromTrips(tenantId, jobId);
    }

    return { success: true, mode: "cancelled", tripId, status: TripStatus.CANCELLED };
  }

  async reorderTrips(
    tenantId: string,
    jobId: string,
    dto: ReorderJobTripsDto,
    user: any,
  ): Promise<JobDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      include: {
        trips: {
          select: { id: true, status: true },
          orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }],
        },
      },
    });
    if (!job) throw new NotFoundException("Job not found");

    const requestedOrder =
      Array.isArray(dto.tripIdsInOrder) && dto.tripIdsInOrder.length
        ? dto.tripIdsInOrder
        : Array.isArray((dto as any).tripIds)
          ? ((dto as any).tripIds as string[])
          : [];
    const ids = new Set((job.trips ?? []).map((t: { id: string }) => t.id));
    if (requestedOrder.length !== ids.size) {
      throw new BadRequestException("tripIdsInOrder must include every trip exactly once");
    }
    for (const id of requestedOrder) {
      if (!ids.has(id)) throw new BadRequestException(`Unknown trip id: ${id}`);
    }

    const existingOrder = (job.trips ?? []).map((t: { id: string }) => t.id);
    const existingIndex = new Map(existingOrder.map((id, idx) => [id, idx] as const));
    const terminalTrips = (job.trips ?? []).filter((t: any) => isTerminalStatus(t.status));
    const movedTerminalTrips = terminalTrips.filter((t: any) =>
      existingIndex.get(t.id) !== requestedOrder.indexOf(t.id)
    );
    if (movedTerminalTrips.length > 0) {
      throw new BadRequestException(
        "Terminal trips (COMPLETED/DONE/CANCELLED) cannot be moved in reorder",
      );
    }

    let seq = 1;
    await this.prisma.$transaction(async (tx) => {
      for (const tripId of requestedOrder) {
        await tx.trip.update({
          where: { id: tripId },
          data: {
            jobSequence: seq,
            tripSequence: seq++,
            routeVersion: { increment: 1 },
          },
        });
      }
    });

    await this.audit.log(
      tenantId,
      "TRIP_REORDER",
      "JOB",
      jobId,
      { order: requestedOrder },
      actorUserId,
    );

    return this.getOne(tenantId, jobId, user);
  }

  private async getTripPublishState(
    tenantId: string,
    trip: {
      id: string;
      status: TripStatus;
      driverEarningCents: number | null;
      assignedDriverUserId: string | null;
      driverId: string | null;
      vehicleId: string | null;
      fleetVehicleId: string | null;
    },
  ): Promise<{ readiness: TripPublishReadinessResult; payoutLines: any[] }> {
    const payoutLines =
      (this.prisma as any).tripPayoutLine?.findMany
        ? await this.prisma.tripPayoutLine.findMany({
            where: { tenantId, tripId: trip.id },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          })
        : [];
    const readiness = evaluateTripPublishReadiness({
      status: trip.status,
      assignedDriverUserId: trip.assignedDriverUserId ?? null,
      driverId: trip.driverId ?? null,
      vehicleId: trip.vehicleId ?? null,
      fleetVehicleId: trip.fleetVehicleId ?? null,
      driverEarningCents: trip.driverEarningCents ?? null,
      payoutLines,
    });
    return { readiness, payoutLines };
  }

  async suggestTripOrder(
    tenantId: string,
    jobId: string,
    dto: SuggestJobTripOrderDto,
    user: any,
  ): Promise<{
    suggestedTripIdsInOrder: string[];
    reason: string;
    warnings: string[];
    skippedTripIds: string[];
    strategy: "DISTANCE";
  }> {
    this.assertCustomerCanOnlyRead(user);
    const job = await this.prisma.job.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException("Job not found");
    this.assertCanAccessJob(job, user);

    const trips = await this.prisma.trip.findMany({
      where: { tenantId, jobId },
      orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        status: true,
        assignedDriverUserId: true,
        originLat: true,
        originLng: true,
        destinationLat: true,
        destinationLng: true,
      },
    });

    const requestedTripIds = Array.isArray(dto.tripIds) ? dto.tripIds : [];
    const tripById = new Map(trips.map((t) => [t.id, t] as const));
    for (const tripId of requestedTripIds) {
      if (!tripById.has(tripId)) {
        throw new BadRequestException(`Unknown trip id: ${tripId}`);
      }
    }

    const candidatePool = requestedTripIds.length
      ? requestedTripIds.map((id) => tripById.get(id)!).filter(Boolean)
      : trips;
    const eligible = candidatePool.filter((trip) => isPlanningEligibleStatus(trip.status));
    const skippedTripIds = candidatePool
      .filter((trip) => !isPlanningEligibleStatus(trip.status))
      .map((trip) => trip.id);

    const warnings: string[] = [];
    let startLocation: { lat: number; lng: number } | null = dto.startLocation
      ? { lat: dto.startLocation.lat, lng: dto.startLocation.lng }
      : null;
    let usedDriverGps = false;

    if (!startLocation && dto.useDriverLatestLocation === true && eligible.length > 0) {
      const assignedDriverIds = Array.from(
        new Set(
          eligible
            .map((trip) => String(trip.assignedDriverUserId ?? "").trim())
            .filter((id) => id.length > 0),
        ),
      );

      if (assignedDriverIds.length !== 1) {
        warnings.push("Trips have different assigned drivers; driver GPS was not used.");
      } else {
        const driverUserId = assignedDriverIds[0];
        const latestLocation = await this.prisma.driverLocationLatest.findUnique({
          where: {
            tenantId_driverUserId: {
              tenantId,
              driverUserId,
            },
          },
          select: {
            lat: true,
            lng: true,
            capturedAt: true,
            recordedAt: true,
            updatedAt: true,
          },
        });
        const gpsTimestamp =
          latestLocation?.capturedAt
          ?? latestLocation?.recordedAt
          ?? latestLocation?.updatedAt
          ?? null;
        const hasUsableGps =
          latestLocation != null
          && typeof latestLocation.lat === "number"
          && typeof latestLocation.lng === "number"
          && gpsTimestamp != null;
        if (hasUsableGps) {
          startLocation = {
            lat: latestLocation!.lat,
            lng: latestLocation!.lng,
          };
          usedDriverGps = true;
        } else {
          warnings.push("No recent driver GPS found; driver GPS was not used.");
        }
      }
    }

    const suggestion = suggestTripOrderByNearestNeighbour({
      trips: eligible.map((trip) => ({
        id: trip.id,
        originLat: trip.originLat,
        originLng: trip.originLng,
        destinationLat: trip.destinationLat,
        destinationLng: trip.destinationLng,
      })),
      startLocation,
    });

    warnings.push(...suggestion.warnings);
    if (dto.strategy && dto.strategy !== "DISTANCE") {
      warnings.push("Requested strategy is not traffic-aware; distance heuristic was used.");
    }

    return {
      suggestedTripIdsInOrder: suggestion.suggestedTripIdsInOrder,
      reason: usedDriverGps
        ? "Suggested from driver's latest GPS using stop distance. This is not traffic-aware."
        : "Suggested using distance between available stop coordinates. This is not traffic-aware.",
      warnings,
      skippedTripIds,
      strategy: "DISTANCE",
    };
  }

  async publishTripRoute(
    tenantId: string,
    jobId: string,
    dto: PublishJobTripRouteDto,
    user: any,
  ): Promise<{
    ok: true;
    jobId: string;
    orderedTripIds: string[];
    publishedTripIds: string[];
    alreadyPublishedTripIds: string[];
    skippedTripIds: string[];
  }> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      select: { id: true, internalRef: true, customerCompanyId: true },
    });
    if (!job) throw new NotFoundException("Job not found");
    this.assertCanAccessJob(job as any, user);

    const trips = await this.prisma.trip.findMany({
      where: { tenantId, jobId },
      orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        status: true,
        tripSequence: true,
        jobSequence: true,
        driverEarningCents: true,
        assignedDriverUserId: true,
        driverId: true,
        vehicleId: true,
        fleetVehicleId: true,
      },
    });
    const tripById = new Map(trips.map((t) => [t.id, t] as const));
    const planningTrips = trips.filter((t) => isPlanningEligibleStatus(t.status));
    const planningIds = planningTrips.map((t) => t.id);

    const orderedTripIds = Array.isArray(dto.tripIdsInOrder) ? dto.tripIdsInOrder : [];
    if (orderedTripIds.length > 0) {
      const expected = new Set(planningIds);
      if (orderedTripIds.length !== expected.size) {
        throw new BadRequestException(
          "tripIdsInOrder must include exactly all planning trips (DRAFT/PUBLISHED)",
        );
      }
      for (const tripId of orderedTripIds) {
        if (!expected.has(tripId)) {
          throw new BadRequestException(`tripIdsInOrder contains non-planning or unknown trip: ${tripId}`);
        }
      }
      let seq = 1;
      await this.prisma.$transaction(async (tx) => {
        for (const tripId of orderedTripIds) {
          await tx.trip.update({
            where: { id: tripId },
            data: {
              tripSequence: seq,
              jobSequence: seq,
              routeVersion: { increment: 1 },
            },
          });
          seq += 1;
        }
      });
      await this.audit.log(
        tenantId,
        "TRIP_ROUTE_REORDER",
        "JOB",
        jobId,
        { orderedTripIds, source: "ROUTE_PLAN" },
        actorUserId,
      );
    }

    const requestedPublishIds = Array.isArray(dto.publishTripIds) && dto.publishTripIds.length
      ? dto.publishTripIds
      : planningIds;
    for (const tripId of requestedPublishIds) {
      if (!tripById.has(tripId)) {
        throw new BadRequestException(`Unknown trip id: ${tripId}`);
      }
    }

    const selectedTrips = requestedPublishIds.map((id) => tripById.get(id)!);
    const alreadyPublishedTripIds = selectedTrips
      .filter((trip) => trip.status === TripStatus.PUBLISHED)
      .map((trip) => trip.id);
    const publishCandidates = selectedTrips.filter((trip) => trip.status === TripStatus.DRAFT);
    const skippedTripIds = selectedTrips
      .filter((trip) =>
        trip.status === TripStatus.ONGOING
        || trip.status === TripStatus.COMPLETED
        || trip.status === TripStatus.DONE
        || trip.status === TripStatus.CANCELLED
      )
      .map((trip) => trip.id);

    const blockedTrips: PublishRouteBlockedTrip[] = [];
    const readyTripIds: string[] = [];
    const payoutLineCountByTrip = new Map<string, number>();
    const payoutTotalByTrip = new Map<string, number>();
    for (const trip of publishCandidates) {
      const { readiness, payoutLines } = await this.getTripPublishState(tenantId, trip);
      if (!readiness.canPublish) {
        blockedTrips.push({
          tripId: trip.id,
          tripDisplayRef: buildTripDisplayRef({
            jobInternalRef: job.internalRef,
            tripSequence: trip.tripSequence,
            jobSequence: trip.jobSequence,
            tripId: trip.id,
          }),
          reason: readiness.errorMessage ?? "Trip is not ready to publish",
        });
      } else {
        readyTripIds.push(trip.id);
        payoutLineCountByTrip.set(trip.id, payoutLines.length);
        payoutTotalByTrip.set(trip.id, readiness.totalPayoutCents);
      }
    }

    if (blockedTrips.length > 0) {
      throw new BadRequestException({
        message: "Some trips are not ready to publish",
        blockedTrips,
      });
    }

    if (readyTripIds.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const tripId of readyTripIds) {
          const payoutLineCount = payoutLineCountByTrip.get(tripId) ?? 0;
          if (payoutLineCount > 0) {
            await tx.trip.update({
              where: { id: tripId },
              data: {
                driverEarningCents: payoutTotalByTrip.get(tripId) ?? null,
                earningLabelSnapshot: `${payoutLineCount} payout items`,
              },
            });
          }
          await tx.trip.update({
            where: { id: tripId },
            data: {
              status: TripStatus.PUBLISHED,
              pendingState: TripPendingState.NONE,
              publishedAt: new Date(),
              publishedByUserId: actorUserId,
            },
          });
        }
      });
    }

    await this.audit.log(
      tenantId,
      "TRIP_ROUTE_PUBLISH",
      "JOB",
      jobId,
      {
        orderedTripIds,
        publishedTripIds: readyTripIds,
        alreadyPublishedTripIds,
      },
      actorUserId,
    );

    return {
      ok: true,
      jobId,
      orderedTripIds,
      publishedTripIds: readyTripIds,
      alreadyPublishedTripIds,
      skippedTripIds,
    };
  }

  async patchTrip(
    tenantId: string,
    jobId: string,
    tripId: string,
    dto: PatchJobTripDto,
    user: any,
  ): Promise<JobDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    if ("status" in (dto as Record<string, unknown>)) {
      throw new BadRequestException(
        "Trip status cannot be changed from PATCH /jobs/:jobId/trips/:tripId",
      );
    }
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
    });
    if (!trip) throw new NotFoundException("Trip not found");

    const data: any = {};
    if (dto.title !== undefined) {
      data.title = dto.title?.trim() || null;
      if (dto.displayTitle === undefined) {
        data.displayTitle = dto.title?.trim() || null;
      }
    }
    if (dto.displayTitle !== undefined) {
      data.displayTitle = dto.displayTitle?.trim() || null;
      if (dto.title === undefined) {
        data.title = dto.displayTitle?.trim() || null;
      }
    }
    if (dto.jobSequence !== undefined) data.jobSequence = dto.jobSequence;
    if (dto.jobSequence !== undefined) data.tripSequence = dto.jobSequence;
    if (dto.plannedStartAt !== undefined) {
      data.plannedStartAt = dto.plannedStartAt
        ? new Date(dto.plannedStartAt)
        : null;
    } else if (dto.plannedDate !== undefined) {
      data.plannedStartAt = dto.plannedDate
        ? new Date(dto.plannedDate + "T00:00:00.000Z")
        : null;
    }
    if (dto.origin !== undefined) {
      if (dto.origin === null) {
        data.originLocationId = null;
        data.originLabel = null;
        data.originAddressLine1 = null;
        data.originAddressLine2 = null;
        data.originPostalCode = null;
        data.originCountry = null;
        data.originLat = null;
        data.originLng = null;
        data.originPlaceId = null;
      } else {
        if (dto.origin.locationId !== undefined) {
          data.originLocationId = dto.origin.locationId?.trim() || null;
        }
        if (dto.origin.label !== undefined) {
          data.originLabel = dto.origin.label?.trim() || null;
        }
        if (dto.origin.addressLine1 !== undefined) {
          data.originAddressLine1 = dto.origin.addressLine1?.trim() || null;
        }
        if (dto.origin.addressLine2 !== undefined) {
          data.originAddressLine2 = dto.origin.addressLine2?.trim() || null;
        }
        if (dto.origin.postalCode !== undefined) {
          data.originPostalCode = dto.origin.postalCode?.trim() || null;
        }
        if (dto.origin.country !== undefined) {
          data.originCountry = dto.origin.country?.trim() || null;
        }
        if (dto.origin.lat !== undefined) {
          data.originLat = dto.origin.lat ?? null;
        }
        if (dto.origin.lng !== undefined) {
          data.originLng = dto.origin.lng ?? null;
        }
        if (dto.origin.placeId !== undefined) {
          data.originPlaceId = dto.origin.placeId?.trim() || null;
        }
      }
    }
    if (dto.destination !== undefined) {
      if (dto.destination === null) {
        data.destinationLocationId = null;
        data.destinationLabel = null;
        data.destinationAddressLine1 = null;
        data.destinationAddressLine2 = null;
        data.destinationPostalCode = null;
        data.destinationCountry = null;
        data.destinationLat = null;
        data.destinationLng = null;
        data.destinationPlaceId = null;
      } else {
        if (dto.destination.locationId !== undefined) {
          data.destinationLocationId = dto.destination.locationId?.trim() || null;
        }
        if (dto.destination.label !== undefined) {
          data.destinationLabel = dto.destination.label?.trim() || null;
        }
        if (dto.destination.addressLine1 !== undefined) {
          data.destinationAddressLine1 = dto.destination.addressLine1?.trim() || null;
        }
        if (dto.destination.addressLine2 !== undefined) {
          data.destinationAddressLine2 = dto.destination.addressLine2?.trim() || null;
        }
        if (dto.destination.postalCode !== undefined) {
          data.destinationPostalCode = dto.destination.postalCode?.trim() || null;
        }
        if (dto.destination.country !== undefined) {
          data.destinationCountry = dto.destination.country?.trim() || null;
        }
        if (dto.destination.lat !== undefined) {
          data.destinationLat = dto.destination.lat ?? null;
        }
        if (dto.destination.lng !== undefined) {
          data.destinationLng = dto.destination.lng ?? null;
        }
        if (dto.destination.placeId !== undefined) {
          data.destinationPlaceId = dto.destination.placeId?.trim() || null;
        }
      }
    }
    if (dto.originLocationId !== undefined) {
      if (!dto.originLocationId) {
        data.originLocationId = null;
      } else {
        const master = await this.getActiveLogisticsLocationById(dto.originLocationId);
        if (!master) throw new BadRequestException("originLocationId not found");
        data.originLocationId = master.id;
        data.originLabel = `${master.code} — ${master.name}`;
        data.originAddressLine1 = master.addressLine1;
        data.originAddressLine2 = master.addressLine2 ?? null;
        data.originPostalCode = master.postalCode ?? null;
        data.originCountry = master.country ?? "SG";
        data.originLat = master.lat ?? null;
        data.originLng = master.lng ?? null;
        data.originPlaceId = master.placeId ?? null;
      }
    }
    if (dto.destinationLocationId !== undefined) {
      if (!dto.destinationLocationId) {
        data.destinationLocationId = null;
      } else {
        const master = await this.getActiveLogisticsLocationById(dto.destinationLocationId);
        if (!master) throw new BadRequestException("destinationLocationId not found");
        data.destinationLocationId = master.id;
        data.destinationLabel = `${master.code} — ${master.name}`;
        data.destinationAddressLine1 = master.addressLine1;
        data.destinationAddressLine2 = master.addressLine2 ?? null;
        data.destinationPostalCode = master.postalCode ?? null;
        data.destinationCountry = master.country ?? "SG";
        data.destinationLat = master.lat ?? null;
        data.destinationLng = master.lng ?? null;
        data.destinationPlaceId = master.placeId ?? null;
      }
    }
    if (dto.originSummary !== undefined && !data.originLocationId) {
      data.originLabel = dto.originSummary?.trim() || null;
    }
    if (dto.destinationSummary !== undefined && !data.destinationLocationId) {
      data.destinationLabel = dto.destinationSummary?.trim() || null;
    }
    if (dto.trailerNumber !== undefined) {
      data.trailerNumber = dto.trailerNumber?.trim() || null;
    }
    if (dto.trailerLastLocationCode !== undefined) {
      data.trailerLastLocationCode = dto.trailerLastLocationCode?.trim() || null;
    }
    if (dto.tripPICName !== undefined) {
      data.tripPICName = dto.tripPICName?.trim() || null;
    }
    if (dto.tripPICContact !== undefined) {
      data.tripPICContact = dto.tripPICContact?.trim() || null;
    }
    if (dto.containerNumber !== undefined) {
      data.containerNumber = dto.containerNumber?.trim() || null;
    }
    if (dto.carrier !== undefined) {
      data.carrier = dto.carrier?.trim() || null;
    }
    if (dto.shipper !== undefined) {
      data.shipper = dto.shipper?.trim() || null;
    }
    if (dto.vessel !== undefined) {
      data.vessel = dto.vessel?.trim() || null;
    }

    if (dto.earningRateMasterId !== undefined) {
      if (dto.earningRateMasterId === null) {
        data.earningRateMasterId = null;
        data.payoutItemId = null;
        data.driverEarningCents = null;
        data.earningLabelSnapshot = null;
      } else {
        const master = await this.findValidDriverPayoutItemById(
          tenantId,
          dto.earningRateMasterId,
        );
        if (!master) {
          throw new BadRequestException("Driver trip rate master not found");
        }
        const resolvedAmountCents = master.rateCents ?? null;
        if (master.requiresManualAmount || resolvedAmountCents == null) {
          throw new BadRequestException(
            `Selected payout item "${master.label}" requires manual amount before assignment`,
          );
        }
        data.payoutItemId = master.id;
        data.earningRateMasterId = null;
        data.driverEarningCents = resolvedAmountCents;
        data.earningLabelSnapshot = master.label;
      }
    }

    data.updatedByUserId = actorUserId;
    await this.prisma.trip.update({
      where: { id: tripId },
      data,
    });
    const changedFields = Object.keys(data).filter((k) => k !== "updatedByUserId");

    await this.audit.log(
      tenantId,
      "TRIP_UPDATE",
      "JOB",
      jobId,
      { tripId, changedFields },
      actorUserId,
    );

    if (dto.earningRateMasterId !== undefined && dto.earningRateMasterId) {
      await this.audit.log(
        tenantId,
        "RATE_MASTER_ASSIGN",
        "TRIP",
        tripId,
        { earningRateMasterId: dto.earningRateMasterId },
        actorUserId,
      );
    }

    return this.getOne(tenantId, jobId, user);
  }

  async assignTrip(
    tenantId: string,
    jobId: string,
    tripId: string,
    dto: AssignJobTripDto,
    user: any,
  ): Promise<JobDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
    });
    if (!trip) throw new NotFoundException("Trip not found");

    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        tenantId,
        userId: dto.driverId,
        role: Role.DRIVER,
        status: MembershipStatus.Active,
      },
      select: { userId: true },
    });
    if (!membership) {
      throw new BadRequestException("Driver must belong to tenant and be active");
    }

    const driverRow = await this.prisma.drivers.findFirst({
      where: { tenantId, userId: dto.driverId },
      select: { id: true, assignedVehicleId: true, assignedFleetVehicleId: true },
    });
    const [vehicle, fleetVehicle] = await Promise.all([
      driverRow?.assignedVehicleId
        ? this.prisma.vehicle.findFirst({
            where: { id: driverRow.assignedVehicleId, tenantId },
            select: { id: true, type: true },
          })
        : Promise.resolve(null),
      driverRow?.assignedFleetVehicleId
        ? this.prisma.fleetVehicle.findFirst({
            where: { id: driverRow.assignedFleetVehicleId, tenantId },
            select: { id: true, type: true },
          })
        : Promise.resolve(null),
    ]);
    const resolvedVehicleType = vehicle?.type ?? fleetVehicle?.type ?? null;
    if (
      dto.vehicleType &&
      resolvedVehicleType &&
      String(dto.vehicleType).trim().toUpperCase() !==
        String(resolvedVehicleType).trim().toUpperCase()
    ) {
      throw new BadRequestException(
        `vehicleType "${dto.vehicleType}" does not match driver's assigned vehicle type "${resolvedVehicleType}"`,
      );
    }

    const oldDriverUserId = trip.assignedDriverUserId ?? null;
    await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        assignedDriverUserId: dto.driverId,
        driverId: driverRow?.id ?? null,
        vehicleId: vehicle?.id ?? null,
        fleetVehicleId: fleetVehicle?.id ?? null,
        assignedAt: new Date(),
        assignedByUserId: actorUserId,
        updatedByUserId: actorUserId,
      },
    });
    const assignmentAction =
      oldDriverUserId && oldDriverUserId !== dto.driverId
        ? "TRIP_DRIVER_REASSIGNED"
        : "TRIP_DRIVER_ASSIGNED";
    const actorNameMap = await this.buildUserNameMapByIds(
      tenantId,
      [oldDriverUserId ?? "", dto.driverId].filter(Boolean) as string[],
    );
    await this.audit.log(
      tenantId,
      assignmentAction,
      "TRIP",
      tripId,
      {
        jobId,
        oldDriverUserId,
        oldDriverName:
          (oldDriverUserId && actorNameMap.get(oldDriverUserId)) || null,
        newDriverUserId: dto.driverId,
        newDriverName: actorNameMap.get(dto.driverId) ?? null,
        vehicleType: resolvedVehicleType,
      },
      actorUserId,
    );
    return this.getOne(tenantId, jobId, user);
  }

  async publishTrip(
    tenantId: string,
    jobId: string,
    tripId: string,
    user: any,
  ): Promise<JobDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;

    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
      select: {
        id: true,
        status: true,
        driverEarningCents: true,
        assignedDriverUserId: true,
        driverId: true,
        vehicleId: true,
        fleetVehicleId: true,
      },
    });
    if (!trip) throw new NotFoundException("Trip not found");

    const { readiness, payoutLines } = await this.getTripPublishState(tenantId, trip);
    if (!readiness.canPublish) {
      throw new BadRequestException(readiness.errorMessage ?? "Trip is not ready to publish");
    }
    if (payoutLines.length > 0) {
      await this.prisma.trip.update({
        where: { id: tripId },
        data: {
          driverEarningCents: readiness.totalPayoutCents,
          earningLabelSnapshot: `${readiness.payoutLineCount} payout items`,
        },
      });
    }

    await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        status: TripStatus.PUBLISHED,
        pendingState: TripPendingState.NONE,
        publishedAt: new Date(),
        publishedByUserId: actorUserId,
      },
    });

    await this.audit.log(
      tenantId,
      "TRIP_PUBLISH",
      "TRIP",
      tripId,
      { jobId },
      actorUserId,
    );

    return this.getOne(tenantId, jobId, user);
  }

  async unpublishTrip(
    tenantId: string,
    jobId: string,
    tripId: string,
    user: any,
  ): Promise<{ ok: true; tripId: string; tripDisplayRef: string; status: "DRAFT" }> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;

    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
      select: {
        id: true,
        status: true,
        tripSequence: true,
        jobSequence: true,
        job: { select: { internalRef: true } },
      },
    });
    if (!trip) throw new NotFoundException("Trip not found");

    if (trip.status === TripStatus.DRAFT) {
      throw new BadRequestException("Trip is already unpublished.");
    }
    if (trip.status === TripStatus.CANCELLED) {
      throw new BadRequestException("Cancelled trip cannot be unpublished.");
    }
    if (
      trip.status === TripStatus.ONGOING
      || trip.status === TripStatus.COMPLETED
      || trip.status === TripStatus.DONE
    ) {
      throw new BadRequestException(
        "Trip cannot be unpublished after execution has started.",
      );
    }
    if (trip.status !== TripStatus.PUBLISHED) {
      throw new BadRequestException(`Trip cannot be unpublished from status ${trip.status}.`);
    }

    await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        status: TripStatus.DRAFT,
        publishedAt: null,
        publishedByUserId: null,
        updatedByUserId: actorUserId,
      },
    });

    const tripDisplayRef = buildTripDisplayRef({
      jobInternalRef: trip.job?.internalRef ?? null,
      tripSequence: trip.tripSequence ?? null,
      jobSequence: trip.jobSequence ?? null,
      tripId: trip.id,
    });

    await this.audit.log(
      tenantId,
      "TRIP_UNPUBLISHED",
      "TRIP",
      tripId,
      {
        jobId,
        tripDisplayRef,
        previousStatus: TripStatus.PUBLISHED,
        nextStatus: TripStatus.DRAFT,
      },
      actorUserId,
    );

    return {
      ok: true,
      tripId,
      tripDisplayRef,
      status: TripStatus.DRAFT,
    };
  }

  private async recalculateJobStatusFromTrips(tenantId: string, jobId: string): Promise<void> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      select: { id: true, status: true, invoiceReadyAt: true },
    });
    if (!job || job.status === JobStatus.CANCELLED || job.status === JobStatus.COMPLETED) {
      return;
    }

    const trips = await this.prisma.trip.findMany({
      where: { tenantId, jobId },
      select: { id: true, status: true },
    });
    if (!trips.length) return;

    const readiness = evaluateJobInvoiceReadiness(
      trips.map((trip) => ({ id: trip.id, status: trip.status })),
    );
    const nextStatus = readiness.readyForInvoice
      ? JobStatus.READY_FOR_INVOICE
      : JobStatus.ONGOING;
    const shouldClearInvoiceReadyAt = !readiness.readyForInvoice && !!job.invoiceReadyAt;
    if (job.status !== nextStatus || shouldClearInvoiceReadyAt) {
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: nextStatus,
          ...(shouldClearInvoiceReadyAt ? { invoiceReadyAt: null } : {}),
        },
      });
    }
  }

  async markTripDone(
    tenantId: string,
    jobId: string,
    tripId: string,
    user: any,
  ): Promise<JobDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
      select: { id: true, status: true },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    if (trip.status !== TripStatus.COMPLETED) {
      throw new BadRequestException("Only COMPLETED trips can be marked DONE");
    }

    await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.DONE, pendingState: TripPendingState.NONE },
    });
    await this.recalculateJobStatusFromTrips(tenantId, jobId);
    await this.audit.log(
      tenantId,
      "TRIP_MARK_DONE",
      "TRIP",
      tripId,
      { jobId },
      actorUserId,
    );
    return this.getOne(tenantId, jobId, user);
  }

  async updateTripPendingState(
    tenantId: string,
    jobId: string,
    tripId: string,
    pendingState: TripPendingState,
    user: any,
  ): Promise<JobDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
      select: { id: true, status: true },
    });
    if (!trip) throw new NotFoundException("Trip not found");

    const allowedStatuses = [TripStatus.PUBLISHED, TripStatus.ONGOING];
    if (
      pendingState !== TripPendingState.NONE &&
      !allowedStatuses.includes(trip.status)
    ) {
      throw new BadRequestException(
        `pendingState "${pendingState}" is invalid when trip status is ${trip.status}. Allowed only for PUBLISHED or ONGOING`,
      );
    }

    await this.prisma.trip.update({
      where: { id: tripId },
      data: { pendingState, updatedByUserId: actorUserId },
    });
    await this.audit.log(
      tenantId,
      "TRIP_PENDING_STATE_UPDATE",
      "TRIP",
      tripId,
      { jobId, pendingState },
      actorUserId,
    );
    return this.getOne(tenantId, jobId, user);
  }

  async sendJobToInvoice(
    tenantId: string,
    jobId: string,
    user: any,
  ): Promise<JobDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      select: { id: true, status: true, invoiceReadyAt: true },
    });
    if (!job) throw new NotFoundException("Job not found");
    if (job.status === JobStatus.CANCELLED) {
      throw new BadRequestException("CANCELLED jobs cannot be sent to invoice");
    }
    if (job.status === JobStatus.COMPLETED) {
      throw new BadRequestException("COMPLETED jobs cannot be sent to invoice");
    }
    if (job.status === JobStatus.READY_FOR_INVOICE && job.invoiceReadyAt) {
      const existingInvoice = await this.prisma.invoice.findFirst({
        where: { tenantId, sourceJobId: jobId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      return {
        jobId,
        invoiceReady: true,
        invoiceReadyAt: job.invoiceReadyAt,
        existingInvoiceId: existingInvoice?.id ?? null,
        redirectTo: `/invoices/create?jobId=${jobId}`,
      } as any;
    }

    const trips = await this.prisma.trip.findMany({
      where: { tenantId, jobId },
      select: { id: true, status: true },
      orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }],
    });
    if (trips.length === 0) {
      throw new BadRequestException(
        "Job must have at least one trip before sending to invoice",
      );
    }

    const readiness = evaluateJobInvoiceReadiness(
      trips.map((trip) => ({ id: trip.id, status: trip.status })),
    );
    if (!readiness.readyForInvoice) {
      throw new BadRequestException(readiness.reason);
    }

    // Ensure lifecycle status is derived by centralized recalculation.
    await this.recalculateJobStatusFromTrips(tenantId, jobId);
    const refreshedJob = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      select: { id: true, status: true, invoiceReadyAt: true },
    });
    if (!refreshedJob) throw new NotFoundException("Job not found");
    if (refreshedJob.status !== JobStatus.READY_FOR_INVOICE) {
      throw new BadRequestException(
        "Job is not READY_FOR_INVOICE yet. Please recheck trip completion.",
      );
    }

    if (refreshedJob.invoiceReadyAt) {
      const existingInvoice = await this.prisma.invoice.findFirst({
        where: { tenantId, sourceJobId: jobId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      return {
        jobId,
        invoiceReady: true,
        invoiceReadyAt: refreshedJob.invoiceReadyAt,
        existingInvoiceId: existingInvoice?.id ?? null,
        redirectTo: `/invoices/create?jobId=${jobId}`,
      } as any;
    }

    const now = new Date();
    await this.prisma.job.update({
      where: { id: jobId },
      data: { invoiceReadyAt: now },
    });

    await this.audit.log(
      tenantId,
      "JOB_SEND_TO_INVOICE",
      "JOB",
      jobId,
      { tripCount: trips.length, sentAt: now.toISOString() },
      actorUserId,
    );

    return this.getOne(tenantId, jobId, user);
  }

  async getTracking(
    tenantId: string,
    jobId: string,
    user: any,
  ): Promise<JobTrackingDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      select: {
        customerCompanyId: true,
        trips: {
          where: { status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] } },
          orderBy: [{ plannedStartAt: "asc" }, { createdAt: "asc" }],
          select: {
            assignedDriverUserId: true,
            vehicleId: true,
            fleetVehicleId: true,
          },
        },
        status: true,
      },
    });

    if (!job) throw new NotFoundException("Job not found");

    this.assertCanAccessJob(job, user);

    const primaryTrip = job.trips?.[0] ?? null;
    const latestDriverLocation = primaryTrip?.assignedDriverUserId
      ? await this.prisma.driverLocationLatest.findUnique({
          where: {
            tenantId_driverUserId: {
              tenantId,
              driverUserId: primaryTrip.assignedDriverUserId,
            },
          },
        })
      : null;

    return {
      lastLat: latestDriverLocation?.lat ?? null,
      lastLng: latestDriverLocation?.lng ?? null,
      lastLocationAt: latestDriverLocation?.capturedAt ?? null,
      assignedDriverId: primaryTrip?.assignedDriverUserId ?? null,
      assignedVehicleId: primaryTrip?.vehicleId ?? null,
      assignedFleetVehicleId: primaryTrip?.fleetVehicleId ?? null,
      status: job.status,
    };
  }

  async listTrips(
    tenantId: string,
    jobId: string,
    user: any,
  ): Promise<JobTripResponseDto[]> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      select: {
        id: true,
        customerCompanyId: true,
        receiverName: true,
        receiverPhone: true,
        customerCompany: { select: { name: true } },
        pickupAddress1: true,
        pickupAddress2: true,
        pickupPostal: true,
        deliveryAddress1: true,
        deliveryAddress2: true,
        deliveryPostal: true,
        portName: true,
        pickupPortCode: true,
        exportPortCode: true,
        exportOriginDepotCode: true,
        returningDepotCode: true,
      },
    });
    if (!job) throw new NotFoundException("Job not found");
    this.assertCanAccessJob(job, user);

    const trips = await this.prisma.trip.findMany({
      where: { tenantId, jobId },
      orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }],
      include: {
        vehicles: { select: { id: true, plateNo: true, type: true } },
        fleetVehicle: { select: { id: true, plateNo: true, type: true } },
        documents: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
        payoutLines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    });

    const nameMap = await this.buildUserNameMapByIds(
      tenantId,
      Array.from(
        new Set(
          trips.flatMap((t) =>
            [t.assignedDriverUserId, t.updatedByUserId, t.assignedByUserId].filter(
              Boolean,
            ) as string[],
          ),
        ),
      ),
    );

    const driverLocations = await this.prisma.driverLocationLatest.findMany({
      where: {
        tenantId,
        driverUserId: {
          in: Array.from(new Set(trips.map((t) => t.assignedDriverUserId).filter(Boolean) as string[])),
        },
      },
    });
    const locationByDriver = new Map<string, any>(
      driverLocations.map((d) => [d.driverUserId, d] as [string, any]),
    );

    return await Promise.all(trips.map(async (t) => {
      const route = deriveTripRouteSummaryFromJobAndTemplate(job, t);
      const origin = toTripLocationDto("origin", t);
      const destination = toTripLocationDto("destination", t);
      const loc = t.assignedDriverUserId ? locationByDriver.get(t.assignedDriverUserId) : null;
      const hasStarted = !!t.startedAt || t.status === TripStatus.ONGOING || t.status === TripStatus.COMPLETED || t.status === TripStatus.DONE;
      const lastSeenAt = loc?.capturedAt ?? null;
      const isStale =
        !!lastSeenAt &&
        hasStarted &&
        Date.now() - new Date(lastSeenAt).getTime() > 15 * 60 * 1000;
      const payoutLines = (t.payoutLines ?? []).map((line) => ({
        id: line.id,
        label: line.label,
        code: line.code ?? null,
        amountCents: line.amountCents ?? null,
        requiresManualAmount: line.requiresManualAmount,
        isSelectableForTripEarning: line.isSelectableForTripEarning,
        sortOrder: line.sortOrder ?? 0,
        payoutItemId: line.payoutItemId ?? null,
        earningRateMasterId: line.earningRateMasterId ?? null,
      }));
      const publishReadiness = evaluateTripPublishReadiness({
        status: t.status,
        assignedDriverUserId: t.assignedDriverUserId ?? null,
        driverId: t.driverId ?? null,
        vehicleId: t.vehicleId ?? null,
        fleetVehicleId: t.fleetVehicleId ?? null,
        driverEarningCents: t.driverEarningCents ?? null,
        payoutLines: t.payoutLines ?? [],
      });
      const driverEarningCentsTotal = payoutLines.length
        ? payoutLines
            .filter((line) => line.isSelectableForTripEarning)
            .reduce((sum, line) => sum + (line.amountCents ?? 0), 0)
        : (t.driverEarningCents ?? null);
      const signedDocs = await Promise.all((t.documents ?? []).map((d) => this.attachSignedUrl(d)));
      return {
      ...route,
      id: t.id,
      jobId: job.id,
      tripDisplayRef: buildTripDisplayRef({
        jobInternalRef: job.internalRef ?? null,
        tripSequence: t.tripSequence ?? null,
        jobSequence: t.jobSequence ?? null,
        tripId: t.id,
      }),
      createdAt: t.createdAt ?? null,
      createdByUserId: t.createdByUserId ?? null,
      updatedByUserId: t.updatedByUserId ?? null,
      updatedByName:
        (t.updatedByUserId && nameMap.get(t.updatedByUserId)) || null,
      publishedAt: t.publishedAt ?? null,
      publishedByUserId: t.publishedByUserId ?? null,
      assignedAt: t.assignedAt ?? null,
      assignedByUserId: t.assignedByUserId ?? null,
      assignedDriverUserId: t.assignedDriverUserId ?? null,
      assignedDriverName:
        (t.assignedDriverUserId && nameMap.get(t.assignedDriverUserId)) || null,
      driverId: t.driverId ?? null,
      driverName:
        (t.assignedDriverUserId && nameMap.get(t.assignedDriverUserId)) || null,
      vehicleType: t.vehicles?.type ?? t.fleetVehicle?.type ?? null,
      customerCompanyName: job.customerCompany?.name ?? null,
      contactName: job.receiverName ?? null,
      contactPhone: job.receiverPhone ?? null,
      tripPICName: t.tripPICName ?? null,
      tripPICContact: t.tripPICContact ?? null,
      containerNumber: t.containerNumber ?? null,
      carrier: t.carrier ?? null,
      shipper: t.shipper ?? null,
      vessel: t.vessel ?? null,
      jobSequence: t.jobSequence ?? null,
      tripSequence: t.tripSequence ?? t.jobSequence ?? null,
      jobTripTemplate: t.jobTripTemplate ?? null,
      title: t.title ?? null,
      displayTitle: t.displayTitle ?? t.title ?? null,
      status: t.status,
      isPublished: t.status !== TripStatus.DRAFT,
      isCompleted:
        t.status === TripStatus.COMPLETED || t.status === TripStatus.DONE,
      pendingState: t.pendingState ?? TripPendingState.NONE,
      canPublish: publishReadiness.canPublish,
      canMarkDone: t.status === TripStatus.COMPLETED,
      plannedStartAt: t.plannedStartAt ?? null,
      startedAt: t.startedAt ?? null,
      closedAt: t.closedAt ?? null,
      trailerNumber: t.trailerNumber ?? null,
      trailerLastLocationCode: t.trailerLastLocationCode ?? null,
      driverEarningCents: t.driverEarningCents ?? null,
      hasDriverPayout: Number.isInteger(driverEarningCentsTotal) && (driverEarningCentsTotal ?? 0) > 0,
      earningLabelSnapshot: t.earningLabelSnapshot ?? null,
      earningRateMasterId: t.payoutItemId ?? t.earningRateMasterId ?? null,
      originSummary: route.fromLabel ?? null,
      destinationSummary: route.toLabel ?? null,
      origin,
      destination,
      assignedVehicleId: t.fleetVehicleId ?? t.vehicleId ?? null,
      assignedVehiclePlateNo: t.fleetVehicle?.plateNo ?? t.vehicles?.plateNo ?? null,
      payoutLines,
      driverEarningCentsTotal,
      liveTracking: {
        isTrackable: !!t.assignedDriverUserId,
        hasStarted,
        driverLat: loc?.lat ?? null,
        driverLng: loc?.lng ?? null,
        lastSeenAt,
        isStale: !!isStale,
        destinationLat: destination?.lat ?? null,
        destinationLng: destination?.lng ?? null,
      },
      documents: signedDocs,
      documentStatus: deriveTripDocumentStatus(t.documents ?? []),
      completionRuleJson:
        (t.completionRuleJson as Record<string, unknown> | null) ?? null,
      };
    }));
  }

  async listTripDocuments(tenantId: string, jobId: string, tripId: string, user: any) {
    const job = await this.prisma.job.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException("Job not found");
    this.assertCanAccessJob(job, user);
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, tenantId, jobId } });
    if (!trip) throw new NotFoundException("Trip not found");
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
    return Promise.all(docs.map((d) => this.attachSignedUrl(d)));
  }

  async uploadTripDocument(
    tenantId: string,
    jobId: string,
    tripId: string,
    typeRaw: string,
    file: Express.Multer.File,
    requiresSignature: boolean,
    user: any,
  ) {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const type = String(typeRaw ?? "").trim() as TripDocumentType;
    if (!TRIP_DOC_ALLOWED_TYPES.has(type)) {
      throw new BadRequestException(`Unsupported trip document type: ${typeRaw}`);
    }
    if (!this.isAllowedTripDocument(file)) {
      throw new BadRequestException("Unsupported file type for trip document");
    }
    const singleActiveTripTypes = new Set<TripDocumentType>([
      TripDocumentType.PICKUP_DO,
      TripDocumentType.DELIVERY_DO,
      TripDocumentType.POD_SIGNATURE,
    ]);
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, tenantId, jobId } });
    if (!trip) throw new NotFoundException("Trip not found");
    const ext = file.originalname?.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
    const base = this.safeFileName((file.originalname ?? "trip-doc").replace(/\.[a-z0-9]+$/i, "")) || "trip-doc";
    const key = `${tenantId}/jobs/${jobId}/trips/${tripId}/${type.toLowerCase()}/${Date.now()}-${base}${ext}`;
    await this.putJobDocumentObject(key, file.buffer, file.mimetype ?? "application/octet-stream");
    const previousDoc = singleActiveTripTypes.has(type)
      ? await this.replaceTripDocumentByType(tenantId, tripId, type)
      : null;
    const doc = await this.prisma.tripDocument.create({
      data: {
        tenantId,
        tripId,
        type,
        isActive: true,
        storageKey: key,
        originalName: file.originalname ?? "trip-doc",
        mimeType: file.mimetype ?? "application/octet-stream",
        sizeBytes: file.size ?? null,
        uploadedByUserId: actorUserId ?? null,
        uploadedByNameSnapshot:
          user?.name?.trim() || user?.email?.trim() || null,
        requiresSignature:
          type === TripDocumentType.POD_SIGNATURE
            ? false
            : !!requiresSignature,
      },
    });
    await this.audit.log(
      tenantId,
      previousDoc ? "TRIP_DOC_REPLACE" : "TRIP_DOC_UPLOAD",
      "TRIP",
      tripId,
      {
        type,
        documentId: doc.id,
        previousDocumentId: previousDoc?.id ?? null,
        originalName: doc.originalName,
        tripId,
        jobId,
      },
      actorUserId,
    );
    return this.attachSignedUrl(doc);
  }

  async signTripDocument(
    tenantId: string,
    jobId: string,
    tripId: string,
    documentId: string,
    signedByName: string | undefined,
    user: any,
  ) {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, tenantId, jobId } });
    if (!trip) throw new NotFoundException("Trip not found");
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
        signedByUserId: actorUserId ?? null,
        signedByName: signedByName?.trim() || null,
      },
    });
    await this.audit.log(
      tenantId,
      "TRIP_DOC_SIGN",
      "TRIP",
      tripId,
      { jobId, documentId },
      actorUserId,
    );
    return this.attachSignedUrl(updated);
  }

  async getTripDetail(tenantId: string, tripId: string, user: any) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId },
      include: {
        job: {
          select: {
            id: true,
            customerCompanyId: true,
            internalRef: true,
            externalRef: true,
            jobType: true,
            status: true,
            receiverName: true,
            receiverPhone: true,
            createdAt: true,
            createdByUserId: true,
            createdBy: { select: { id: true, name: true, email: true } },
            items: {
              orderBy: { createdAt: "asc" },
              select: { id: true, itemCode: true, description: true, qty: true },
            },
            customerCompany: { select: { name: true } },
          },
        },
        vehicles: { select: { id: true, plateNo: true, type: true } },
        fleetVehicle: { select: { id: true, plateNo: true, type: true } },
        documents: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
        payoutLines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        documentRequirements: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    if (trip.job) this.assertCanAccessJob(trip.job, user);
    const driverLoc = trip.assignedDriverUserId
      ? await this.prisma.driverLocationLatest.findUnique({
          where: {
            tenantId_driverUserId: {
              tenantId,
              driverUserId: trip.assignedDriverUserId,
            },
          },
        })
      : null;
    const docs = await Promise.all((trip.documents ?? []).map((d) => this.attachSignedUrl(d)));
    const driverNameMap = await this.buildUserNameMapByIds(
      tenantId,
      [
        trip.assignedDriverUserId,
        trip.createdByUserId,
        trip.publishedByUserId,
        trip.updatedByUserId,
        trip.assignedByUserId,
      ].filter(Boolean) as string[],
    );
    const driverName = trip.assignedDriverUserId
      ? (driverNameMap.get(trip.assignedDriverUserId) ?? null)
      : null;
    const createdByName = trip.createdByUserId
      ? (driverNameMap.get(trip.createdByUserId) ?? null)
      : null;
    const publishedByName = trip.publishedByUserId
      ? (driverNameMap.get(trip.publishedByUserId) ?? null)
      : null;
    const updatedByName = trip.updatedByUserId
      ? (driverNameMap.get(trip.updatedByUserId) ?? null)
      : null;
    const documentStatus = deriveTripDocumentStatus(trip.documents ?? []);
    const payoutLines = (trip.payoutLines ?? []).map((line: any) => ({
      id: line.id,
      sourceRateMasterItemId: line.payoutItemId ?? null,
      code: line.code ?? null,
      label: line.label,
      description: line.description ?? null,
      unit: line.unit ?? null,
      quantity: line.quantity ?? 1,
      amountCents: line.amountCents ?? null,
      totalCents:
        line.totalCents ??
        ((line.amountCents ?? null) != null
          ? (line.quantity ?? 1) * line.amountCents
          : null),
      notes: line.notes ?? null,
      isManual: line.isManual ?? false,
    }));
    const publishReadiness = evaluateTripPublishReadiness({
      status: trip.status,
      assignedDriverUserId: trip.assignedDriverUserId ?? null,
      driverId: trip.driverId ?? null,
      vehicleId: trip.vehicleId ?? null,
      fleetVehicleId: trip.fleetVehicleId ?? null,
      driverEarningCents: trip.driverEarningCents ?? null,
      payoutLines: trip.payoutLines ?? [],
    });
    const routeOriginLabel =
      firstNonEmptyText(
        trip.originLabel,
        trip.originAddressLine1,
        trip.originAddressLine2,
        trip.originPostalCode,
      ) ?? null;
    const routeDestinationLabel =
      firstNonEmptyText(
        trip.destinationLabel,
        trip.destinationAddressLine1,
        trip.destinationAddressLine2,
        trip.destinationPostalCode,
      ) ?? null;
    const routeSummary =
      routeOriginLabel && routeDestinationLabel
        ? `${routeOriginLabel} -> ${routeDestinationLabel}`
        : routeOriginLabel || routeDestinationLabel || null;
    const cargoItems = Array.isArray(trip.job?.items) ? trip.job.items : [];
    const isContainerMode =
      trip.job?.jobType === JobType.IMPORT || trip.job?.jobType === JobType.EXPORT;
    const cargo = isContainerMode
      ? {
          mode: "CONTAINER",
          containers: cargoItems.map((item: any) => ({
            id: item.id,
            containerNumber: item.itemCode,
            containerSize: null,
            sealNo: null,
            weight: null,
            remarks: item.description ?? null,
          })),
        }
      : {
          mode: "ITEMS",
          items: cargoItems.map((item: any) => ({
            id: item.id,
            itemCode: item.itemCode,
            description: item.description ?? null,
            quantity: item.qty ?? null,
            uom: null,
            weight: null,
            volume: null,
            remarks: null,
          })),
        };
    return {
      id: trip.id,
      jobId: trip.jobId ?? null,
      jobSequence: trip.jobSequence ?? null,
      tripSequence: trip.tripSequence ?? trip.jobSequence ?? null,
      tripDisplayRef: buildTripDisplayRef({
        jobInternalRef: trip.job?.internalRef ?? null,
        tripSequence: trip.tripSequence ?? null,
        jobSequence: trip.jobSequence ?? null,
        tripId: trip.id,
      }),
      title: trip.title ?? null,
      displayTitle: trip.displayTitle ?? trip.title ?? null,
      status: trip.status,
      pendingState: trip.pendingState ?? TripPendingState.NONE,
      createdByUserId: trip.createdByUserId ?? null,
      createdByName,
      updatedByUserId: trip.updatedByUserId ?? null,
      updatedByName,
      createdAt: trip.createdAt ?? null,
      publishedAt: trip.publishedAt ?? null,
      publishedByUserId: trip.publishedByUserId ?? null,
      publishedByName,
      assignedAt: trip.assignedAt ?? null,
      assignedByUserId: trip.assignedByUserId ?? null,
      canPublish: publishReadiness.canPublish,
      canMarkDone: trip.status === TripStatus.COMPLETED,
      driverId: trip.assignedDriverUserId ?? null,
      driverName,
      vehicleType: trip.vehicles?.type ?? trip.fleetVehicle?.type ?? null,
      customerCompanyName: trip.job?.customerCompany?.name ?? null,
      contactName: trip.job?.receiverName ?? null,
      contactPhone: trip.job?.receiverPhone ?? null,
      tripPICName: trip.tripPICName ?? null,
      tripPICContact: trip.tripPICContact ?? null,
      containerNumber: trip.containerNumber ?? null,
      carrier: trip.carrier ?? null,
      shipper: trip.shipper ?? null,
      vessel: trip.vessel ?? null,
      plannedStartAt: trip.plannedStartAt ?? null,
      startedAt: trip.startedAt ?? null,
      completedAt: trip.closedAt ?? null,
      closedAt: trip.closedAt ?? null,
      job: trip.job
        ? {
            id: trip.job.id,
            internalRef: trip.job.internalRef,
            externalRef: trip.job.externalRef ?? null,
            jobType: trip.job.jobType,
            status: trip.job.status,
            customerCompanyId: trip.job.customerCompanyId,
            customerCompanyName: trip.job.customerCompany?.name ?? null,
            contactName: trip.job.receiverName ?? null,
            contactPhone: trip.job.receiverPhone ?? null,
            createdAt: trip.job.createdAt,
            createdByName:
              trip.job.createdBy?.name?.trim() || trip.job.createdBy?.email || null,
          }
        : null,
      cargo,
      route: {
        origin: toTripLocationDto("origin", trip),
        destination: toTripLocationDto("destination", trip),
      },
      routeDisplay: {
        fromLabel: routeOriginLabel,
        toLabel: routeDestinationLabel,
        summary: routeSummary,
      },
      assignment: {
        driverId: trip.assignedDriverUserId ?? null,
        driverName,
        vehicleId: trip.fleetVehicleId ?? trip.vehicleId ?? null,
        vehiclePlateNo: trip.fleetVehicle?.plateNo ?? trip.vehicles?.plateNo ?? null,
        vehicleType: trip.vehicles?.type ?? trip.fleetVehicle?.type ?? null,
      },
      payout: {
        earningRateMasterId: trip.payoutItemId ?? trip.earningRateMasterId ?? null,
        driverEarningCents: trip.driverEarningCents ?? null,
        lines: payoutLines,
      },
      payoutLines,
      documents: docs,
      documentStatus,
      documentRequirements: trip.documentRequirements ?? [],
      trackingSummary: {
        driverLat: driverLoc?.lat ?? null,
        driverLng: driverLoc?.lng ?? null,
        lastSeenAt: driverLoc?.capturedAt ?? null,
        isTrackable: !!trip.assignedDriverUserId,
      },
      completionRuleJson: trip.completionRuleJson ?? null,
      driverEarningCents: trip.driverEarningCents ?? null,
      earningRateMasterId: trip.payoutItemId ?? trip.earningRateMasterId ?? null,
    };
  }

  async listTripPayoutLines(tenantId: string, jobId: string, tripId: string, user: any) {
    const job = await this.prisma.job.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException("Job not found");
    this.assertCanAccessJob(job, user);
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, tenantId, jobId } });
    if (!trip) throw new NotFoundException("Trip not found");
    return this.prisma.tripPayoutLine.findMany({
      where: { tenantId, tripId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  async replaceTripPayoutLines(
    tenantId: string,
    jobId: string,
    tripId: string,
    lines: TripPayoutLineInputDto[],
    user: any,
  ) {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, tenantId, jobId } });
    if (!trip) throw new NotFoundException("Trip not found");
    const normalized = (lines ?? []).map((line, idx) => {
      const qty = Math.max(0, Number(line.quantity ?? 1) || 1);
      const amountCents = line.amountCents ?? null;
      const computedTotalCents =
        line.totalCents ?? (amountCents != null ? qty * amountCents : null);
      return {
      tenantId,
      tripId,
      sourceType: JobChargeSourceType.DRIVER_RATE_MASTER,
      payoutItemId: line.sourceRateMasterItemId ?? line.payoutItemId ?? null,
      earningRateMasterId: line.earningRateMasterId ?? null,
      code: line.code ?? null,
      label: String(line.label ?? "").trim(),
      description: line.description ?? null,
      unit: line.unit ?? null,
      quantity: qty,
      amountCents: line.amountCents ?? null,
      totalCents: computedTotalCents,
      notes: line.notes ?? null,
      isManual: line.isManual ?? false,
      requiresManualAmount: !!line.requiresManualAmount,
      isSelectableForTripEarning: line.isSelectableForTripEarning !== false,
      sortOrder: Number.isFinite(Number(line.sortOrder)) ? Number(line.sortOrder) : idx + 1,
      };
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.tripPayoutLine.deleteMany({ where: { tenantId, tripId } });
      if (normalized.length) await tx.tripPayoutLine.createMany({ data: normalized });
      const selectable = normalized.filter((line) => line.isSelectableForTripEarning);
      const total = selectable.reduce((sum, line) => sum + (line.totalCents ?? 0), 0);
      await tx.trip.update({
        where: { id: tripId },
        data: {
          driverEarningCents: selectable.length ? total : null,
          earningLabelSnapshot: normalized.length ? `${normalized.length} payout items` : null,
          updatedByUserId: actorUserId,
        },
      });
    });
    await this.audit.log(tenantId, "TRIP_PAYOUT_LINES_REPLACE", "TRIP", tripId, { lineCount: normalized.length }, actorUserId);
    return this.listTripPayoutLines(tenantId, jobId, tripId, user);
  }

  async saveTripPayoutDraft(
    tenantId: string,
    jobId: string,
    tripId: string,
    dto: PatchTripPayoutDto,
    user: any,
  ): Promise<JobDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, tenantId, jobId } });
    if (!trip) throw new NotFoundException("Trip not found");

    let selectedMaster: any = null;
    if (dto.earningRateMasterId) {
      selectedMaster = await this.findValidDriverPayoutItemById(
        tenantId,
        dto.earningRateMasterId,
      );
      if (!selectedMaster) {
        throw new BadRequestException("Driver trip rate master not found");
      }
      if (selectedMaster.requiresManualAmount || selectedMaster.rateCents == null) {
        throw new BadRequestException(
          `Selected payout item "${selectedMaster.label}" requires manual amount before assignment`,
        );
      }
    }

    const normalized = (dto.payoutLines ?? []).map((line, idx) => {
      const quantity = Math.max(0, Number(line.quantity ?? 1) || 1);
      const amountCents =
        line.amountCents != null ? Number(line.amountCents) : null;
      const totalCents =
        line.totalCents != null
          ? Number(line.totalCents)
          : amountCents != null
            ? quantity * amountCents
            : null;
      return {
        idx,
        sourceRateMasterItemId:
          line.sourceRateMasterItemId ?? line.payoutItemId ?? null,
        code: line.code ?? null,
        label: String(line.label ?? "").trim(),
        description: line.description ?? null,
        unit: line.unit ?? null,
        quantity,
        amountCents,
        totalCents,
        notes: line.notes ?? null,
        isManual: !!line.isManual,
      };
    });

    for (const line of normalized) {
      if (!line.label) {
        throw new BadRequestException(`payoutLines[${line.idx}].label is required`);
      }
      if (line.sourceRateMasterItemId) {
        const sourceItem = await this.findValidDriverPayoutItemById(
          tenantId,
          line.sourceRateMasterItemId,
        );
        if (!sourceItem) {
          throw new BadRequestException(
            `Invalid sourceRateMasterItemId at payoutLines[${line.idx}]`,
          );
        }
        if (sourceItem.requiresManualAmount && line.amountCents == null) {
          throw new BadRequestException(
            `payoutLines[${line.idx}] requires amountCents for manual payout item "${sourceItem.label}"`,
          );
        }
      }
    }

    const totalDriverEarningCents = normalized.reduce(
      (sum, line) => sum + (line.totalCents ?? 0),
      0,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.tripPayoutLine.deleteMany({ where: { tenantId, tripId } });
      if (normalized.length) {
        await tx.tripPayoutLine.createMany({
          data: normalized.map((line) => ({
            tenantId,
            tripId,
            sourceType: JobChargeSourceType.DRIVER_RATE_MASTER,
            payoutItemId: line.sourceRateMasterItemId,
            earningRateMasterId: null,
            code: line.code,
            label: line.label,
            description: line.description,
            unit: line.unit,
            quantity: line.quantity,
            amountCents: line.amountCents,
            totalCents: line.totalCents,
            notes: line.notes,
            isManual: line.isManual,
            requiresManualAmount: line.isManual,
            isSelectableForTripEarning: true,
            sortOrder: line.idx + 1,
          })),
        });
      }
      await tx.trip.update({
        where: { id: tripId },
        data: {
          earningRateMasterId: null,
          payoutItemId: selectedMaster?.id ?? null,
          driverEarningCents: totalDriverEarningCents,
          earningLabelSnapshot: normalized.length
            ? `${normalized.length} payout items`
            : null,
          updatedByUserId: actorUserId,
        },
      });
    });

    await this.audit.log(
      tenantId,
      "TRIP_PAYOUT_DRAFT_SAVE",
      "TRIP",
      tripId,
      {
        jobId,
        earningRateMasterId: selectedMaster?.id ?? null,
        lineCount: normalized.length,
        totalDriverEarningCents,
      },
      actorUserId,
    );

    return this.getOne(tenantId, jobId, user);
  }

  async listLiveTripTracking(tenantId: string, user: any) {
    const whereJob = this.applyJobAccessFilter(tenantId, user);
    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        assignedDriverUserId: { not: null },
        status: { in: [TripStatus.PUBLISHED, TripStatus.ONGOING] },
        jobId: { not: null },
        job: whereJob,
      },
      include: {
        job: { select: { id: true, internalRef: true, customerCompanyId: true } },
        vehicles: { select: { plateNo: true } },
        fleetVehicle: { select: { plateNo: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
    });
    const nameMap = await this.buildUserNameMapByIds(
      tenantId,
      trips.map((t) => t.assignedDriverUserId).filter(Boolean) as string[],
    );
    const locs = await this.prisma.driverLocationLatest.findMany({
      where: {
        tenantId,
        driverUserId: { in: trips.map((t) => t.assignedDriverUserId!).filter(Boolean) },
      },
    });
    const locMap = new Map<string, any>(
      locs.map((l) => [l.driverUserId, l] as [string, any]),
    );
    return trips.map((trip) => {
      const loc = trip.assignedDriverUserId ? locMap.get(trip.assignedDriverUserId) : null;
      return {
        jobId: trip.jobId,
        tripId: trip.id,
        tripDisplayRef: buildTripDisplayRef({
          jobInternalRef: trip.job?.internalRef ?? null,
          tripSequence: trip.tripSequence ?? null,
          jobSequence: trip.jobSequence ?? null,
          tripId: trip.id,
        }),
        tripTitle: trip.title ?? null,
        driverId: trip.assignedDriverUserId,
        driverName:
          (trip.assignedDriverUserId && nameMap.get(trip.assignedDriverUserId)) || null,
        vehiclePlateNo: trip.fleetVehicle?.plateNo ?? trip.vehicles?.plateNo ?? null,
        status: trip.status,
        driverLat: loc?.lat ?? null,
        driverLng: loc?.lng ?? null,
        lastSeenAt: loc?.capturedAt ?? null,
        destinationLabel: trip.destinationLabel ?? null,
        destinationLat: trip.destinationLat ?? null,
        destinationLng: trip.destinationLng ?? null,
      };
    });
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
    if (!row.deliveryAddress?.trim())
      errors.push("deliveryAddress is required");
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
      const normalizedName = companyCode
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
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
    user: any,
  ): Promise<{
    createdCount: number;
    failedRows: { rowNumber: number; reason: string }[];
  }> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
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
        let assignedFleetVehicleId: string | null = null;

        if (driverId) {
          const driver = await this.prisma.drivers.findFirst({
            where: { tenantId, userId: driverId },
            select: { assignedVehicleId: true, assignedFleetVehicleId: true },
          });
          if (driver?.assignedVehicleId && driver?.assignedFleetVehicleId) {
            throw new BadRequestException(
              "Driver has inconsistent default assignment (both vehicle and fleet vehicle)",
            );
          }
          assignedVehicleId = driver?.assignedVehicleId ?? null;
          assignedFleetVehicleId = driver?.assignedFleetVehicleId ?? null;
        }

        const internalRef = await this.getNextInternalRef(tenantId, jobType);

        const pickupDateParsed = row.pickupDate
          ? new Date(row.pickupDate)
          : null;

        const job = await this.prisma.job.create({
          data: {
            tenantId,
            customerCompanyId,
            internalRef,
            jobType,
            status: JobStatus.ONGOING,
            createdByUserId: actorUserId,
            pickupDate: pickupDateParsed,
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
              assignedFleetVehicleId,
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

        await this.prisma.trip.createMany({
          data: tripCreateManyForJob(
            tenantId,
            job.id,
            jobType,
            pickupDateParsed,
            null,
            {
              vessel: String(job?.vesselName ?? "").trim() || null,
            },
            undefined,
            actorUserId,
          ),
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

  async batchImportPreview(
    tenantId: string,
    buffer: Buffer,
    params: { customerCompanyId: string; jobType: JobType },
  ): Promise<JobBatchImportPreviewResponseDto> {
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: params.customerCompanyId, tenantId },
    });

    if (!company) {
      throw new BadRequestException(
        "Customer company not found or does not belong to tenant",
      );
    }

    const parsed = parseJobBatchImportSheet(buffer);
    const rows = parsed.map((p) => {
      const data = buildJobBatchImportRowDto(p);
      const errors = validateJobBatchImportRowFields(data);
      return { rowNumber: p.rowNumber, data, errors };
    });

    return {
      customerCompanyId: params.customerCompanyId,
      jobType: params.jobType,
      rows,
    };
  }

  async batchImportConfirm(
    tenantId: string,
    dto: JobBatchImportConfirmRequestDto,
    user: any,
  ): Promise<JobBatchImportConfirmResponseDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: dto.customerCompanyId, tenantId },
    });

    if (!company) {
      throw new BadRequestException(
        "Customer company not found or does not belong to tenant",
      );
    }

    const failedRows: { rowNumber: number; reason: string }[] = [];
    const createdIds: string[] = [];
    let createdCount = 0;

    const normalizedRows = dto.rows.map((r) => ({
      rowNumber: r.rowNumber,
      data: normalizeJobBatchImportRowFromBody(r),
    }));

    for (const { rowNumber, data: row } of normalizedRows) {
      const fieldErrors = validateJobBatchImportRowFields(row);
      if (fieldErrors.length > 0) {
        failedRows.push({
          rowNumber,
          reason: fieldErrors.join("; "),
        });
        continue;
      }

      try {
        const internalRef = await this.getNextInternalRef(tenantId, dto.jobType);

        const job = await this.prisma.job.create({
          data: buildBatchImportJobCreateData({
            tenantId,
            customerCompanyId: dto.customerCompanyId,
            jobType: dto.jobType,
            internalRef,
            status: JobStatus.ONGOING,
            row,
            createdByUserId: actorUserId,
          }),
        });

        await this.prisma.trip.createMany({
          data: tripCreateManyForJob(
            tenantId,
            job.id,
            dto.jobType,
            row.pickupDate ? new Date(row.pickupDate) : null,
            null,
            null,
            undefined,
            actorUserId,
          ),
        });

        createdCount++;
        createdIds.push(job.id);

        await this.audit.log(
          tenantId,
          "CREATE",
          "JOB",
          job.id,
          {
            internalRef: job.internalRef,
            externalRef: job.externalRef,
            source: "job_batch_import_confirm",
            batchRowNumber: rowNumber,
          },
          actorUserId,
        );
      } catch (e: any) {
        failedRows.push({
          rowNumber,
          reason: e?.message ?? "Create failed",
        });
      }
    }

    await this.audit.log(
      tenantId,
      "BATCH_IMPORT_CONFIRM",
      "TENANT",
      tenantId,
      {
        customerCompanyId: dto.customerCompanyId,
        jobType: dto.jobType,
        createdCount,
        createdIds,
        failedCount: failedRows.length,
      },
      actorUserId,
    );

    return { createdCount, createdIds, failedRows };
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
        (h) =>
          String(h || "")
            .trim()
            .toLowerCase() === name.toLowerCase(),
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

      if (deliveryAddress1 && !g.deliveryAddress1)
        g.deliveryAddress1 = deliveryAddress1;
      if (deliveryAddress2 && !g.deliveryAddress2)
        g.deliveryAddress2 = deliveryAddress2;
      if (deliveryCity && !g.deliveryCity) g.deliveryCity = deliveryCity;
      if (deliveryPostalCode && !g.deliveryPostalCode) {
        g.deliveryPostalCode = deliveryPostalCode;
      }
      if (deliveryCountry && !g.deliveryCountry)
        g.deliveryCountry = deliveryCountry;
      if (deliveryFirstName && !g.deliveryFirstName) {
        g.deliveryFirstName = deliveryFirstName;
      }
      if (deliveryLastName && !g.deliveryLastName)
        g.deliveryLastName = deliveryLastName;
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
    if (!pickup.pickupAddress1?.trim())
      errors.push("pickupAddress1 is required");
    if (!row.deliveryAddress1?.trim())
      errors.push("deliveryAddress1 is required");

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
    user: any,
  ): Promise<LclImportConfirmResponseDto> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
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
      throw new BadRequestException(
        "pickupDate must be a valid date (YYYY-MM-DD)",
      );
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
        const internalRef = await this.getNextInternalRef(
          tenantId,
          JobType.LCL,
        );

        const job = await this.prisma.job.create({
          data: {
            tenantId,
            customerCompanyId: dto.customerCompanyId,
            internalRef,
            externalRef: row.externalRef || null,
            jobType: JobType.LCL,
            status: JobStatus.ONGOING,
            notes,
            createdByUserId: actorUserId,
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

        await this.prisma.trip.createMany({
          data: tripCreateManyForJob(
            tenantId,
            job.id,
            JobType.LCL,
            pickupDate,
            null,
            null,
            undefined,
            actorUserId,
          ),
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
            createdByUserId: actorUserId,
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

  private async buildDoPdfBuffer(
    job: {
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
      podRecipientName?: string | null;
      deliveredAt?: Date | null;
      customerCompany?: { name: string } | null;
      items: Array<{
        itemCode: string;
        description: string | null;
        qty: number;
      }>;
    },
    options?: {
      signatureImageBytes?: Buffer | null;
      recipientName?: string | null;
      recipientNric?: string | null;
      signedAt?: Date | null;
    },
  ): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
  
    // A4 landscape
    const page = pdfDoc.addPage([841.89, 595.28]);
    const { height, width } = page.getSize();
  
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
    const black = rgb(0, 0, 0);
    const headerFill = rgb(0.84, 0.84, 0.84);
  
    const marginLeft = 42;
    const marginRight = 2; // almost no right padding, to match your sample
    const topY = height - 34;
  
    const orderRef = job.externalRef?.trim() || job.internalRef?.trim() || "-";
    const headerRef =
      [job.externalRef?.trim(), job.internalRef?.trim()]
        .filter(Boolean)
        .join(" / ") || orderRef;
  
    const receiverName =
      options?.recipientName?.trim() ||
      job.podRecipientName?.trim() ||
      job.receiverName?.trim() ||
      "-";
  
    const receiverPhone = job.receiverPhone?.trim() || "-";
    const specialRequest = job.notes?.trim() || "-";
  
    const deliveryAddress =
      [
        job.deliveryAddress1,
        job.deliveryAddress2,
        job.deliveryPostal ? `Singapore ${job.deliveryPostal}` : null,
      ]
        .map((v) => (v ?? "").trim())
        .filter(Boolean)
        .join("\n") || "-";
  
    const items = job.items?.length
      ? job.items
      : [{ itemCode: "-", description: null, qty: 1 }];
  
    const itemCodeText = items
      .map((it) => (it.itemCode || "-").trim())
      .join("\n");
  
    const itemQtyText = items.map((it) => String(it.qty ?? 1)).join("\n");
  
    // ===== LOGO =====
    const logoPathCandidates = [
      path.resolve(process.cwd(), "src/assets/db-logo.png"),
      path.resolve(process.cwd(), "assets/db-logo.png"),
      path.resolve(process.cwd(), "db-logo.png"),
      "/mnt/data/db-logo.png",
    ];
  
    let logoBytes: Buffer | null = null;
    for (const p of logoPathCandidates) {
      if (fs.existsSync(p)) {
        logoBytes = fs.readFileSync(p);
        break;
      }
    }
  
    let currentY = topY;
  
    if (logoBytes) {
      try {
        const logoImage = await pdfDoc.embedPng(logoBytes);
        const maxLogoWidth = 220;
        const scale = maxLogoWidth / logoImage.width;
        const logoWidth = maxLogoWidth;
        const logoHeight = logoImage.height * scale;
  
        page.drawImage(logoImage, {
          x: marginLeft,
          y: currentY - logoHeight,
          width: logoWidth,
          height: logoHeight,
        });
  
        currentY -= logoHeight + 26;
      } catch {
        // ignore logo issues
      }
    }
  
    // ===== ADDRESS =====
    page.drawText("Office and Warehouse : 7 Gul Circle, Singapore 629563", {
      x: marginLeft,
      y: currentY,
      size: 11,
      font,
      color: black,
    });
  
    currentY -= 28;
  
    // ===== REF LINE =====
    page.drawText(headerRef, {
      x: marginLeft,
      y: currentY,
      size: 17,
      font: bold,
      color: black,
    });
  
    currentY -= 30;
  
    // ===== TABLE =====
    const tableX = marginLeft;
    const tableTopY = currentY;
    const headerHeight = 24;
    const cellPaddingX = 6;
    const cellPaddingTop = 16;
    const bodyFontSize = 10;
    const bodyLineHeight = 13;
  
    const totalTableWidth = width - marginLeft - marginRight;
  
    const cols = [
      { label: "Order Ref", width: 95 },
      { label: "First / Last Name", width: 120 },
      { label: "Phone", width: 85 },
      { label: "Delivery Adress", width: 235 },
      { label: "Item Code", width: 120 },
      { label: "Item Qty", width: 55 },
      {
        label: "Special Request",
        width: totalTableWidth - (95 + 120 + 85 + 235 + 120 + 55),
      },
    ] as const;
  
    let cx = tableX;
    for (const col of cols) {
      page.drawRectangle({
        x: cx,
        y: tableTopY - headerHeight,
        width: col.width,
        height: headerHeight,
        color: headerFill,
        borderWidth: 0.8,
        borderColor: black,
      });
  
      page.drawText(col.label, {
        x: cx + 5,
        y: tableTopY - 16,
        size: 8.5,
        font: bold,
        color: black,
      });
  
      cx += col.width;
    }
  
    const rowHeight = this.estimateRowHeight(
      [
        orderRef,
        receiverName,
        receiverPhone,
        deliveryAddress,
        itemCodeText,
        itemQtyText,
        specialRequest,
      ],
      cols.map((c) => c.width - cellPaddingX * 2),
      font,
      bodyFontSize,
      bodyLineHeight,
      110,
    );
  
    const rowTopY = tableTopY - headerHeight;
  
    cx = tableX;
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
  
    cx = tableX;
  
    this.drawMultilineText(
      page,
      orderRef,
      cx + cellPaddingX,
      rowTopY - cellPaddingTop,
      cols[0].width - cellPaddingX * 2,
      font,
      bodyFontSize,
      bodyLineHeight,
      black,
      10,
    );
    cx += cols[0].width;
  
    this.drawMultilineText(
      page,
      receiverName,
      cx + cellPaddingX,
      rowTopY - cellPaddingTop,
      cols[1].width - cellPaddingX * 2,
      font,
      bodyFontSize,
      bodyLineHeight,
      black,
      10,
    );
    cx += cols[1].width;
  
    this.drawMultilineText(
      page,
      receiverPhone,
      cx + cellPaddingX,
      rowTopY - cellPaddingTop,
      cols[2].width - cellPaddingX * 2,
      font,
      bodyFontSize,
      bodyLineHeight,
      black,
      10,
    );
    cx += cols[2].width;
  
    this.drawMultilineText(
      page,
      deliveryAddress,
      cx + cellPaddingX,
      rowTopY - cellPaddingTop,
      cols[3].width - cellPaddingX * 2,
      font,
      bodyFontSize,
      bodyLineHeight,
      black,
      10,
    );
    cx += cols[3].width;
  
    this.drawMultilineText(
      page,
      itemCodeText,
      cx + cellPaddingX,
      rowTopY - cellPaddingTop,
      cols[4].width - cellPaddingX * 2,
      font,
      bodyFontSize,
      bodyLineHeight,
      black,
      10,
    );
    cx += cols[4].width;
  
    this.drawMultilineText(
      page,
      itemQtyText,
      cx + cellPaddingX,
      rowTopY - cellPaddingTop,
      cols[5].width - cellPaddingX * 2,
      font,
      bodyFontSize,
      bodyLineHeight,
      black,
      10,
    );
    cx += cols[5].width;
  
    this.drawMultilineText(
      page,
      specialRequest,
      cx + cellPaddingX,
      rowTopY - cellPaddingTop,
      cols[6].width - cellPaddingX * 2,
      font,
      bodyFontSize,
      bodyLineHeight,
      black,
      10,
    );
  
    // ===== DECLARATION =====
    const declarationY = rowTopY - rowHeight - 52;
  
    page.drawText(
      "Received the above stated goods in good order and condition:",
      {
        x: tableX,
        y: declarationY,
        size: 11,
        font,
        color: black,
      },
    );
  
    // ===== SIGNATURE AREA =====
    const signLineY = declarationY - 56;
    const signLineWidth = 290;
  
    page.drawLine({
      start: { x: tableX, y: signLineY },
      end: { x: tableX + signLineWidth, y: signLineY },
      thickness: 1,
      color: black,
    });
  
    page.drawText("Signature/Name/NRIC No.", {
      x: tableX,
      y: signLineY - 18,
      size: 10,
      font,
      color: black,
    });
  
    // ===== SIGNATURE IMAGE =====
    if (options?.signatureImageBytes) {
      try {
        let signatureImage;
        try {
          signatureImage = await pdfDoc.embedPng(options.signatureImageBytes);
        } catch {
          signatureImage = await pdfDoc.embedJpg(options.signatureImageBytes);
        }
  
        const maxSigWidth = 170;
        const maxSigHeight = 42;
  
        const widthRatio = maxSigWidth / signatureImage.width;
        const heightRatio = maxSigHeight / signatureImage.height;
        const scale = Math.min(widthRatio, heightRatio);
  
        const sigWidth = signatureImage.width * scale;
        const sigHeight = signatureImage.height * scale;
  
        page.drawImage(signatureImage, {
          x: tableX + 8,
          y: signLineY + 2,
          width: sigWidth,
          height: sigHeight,
        });
      } catch {
        // ignore bad signature image
      }
    }
  
    if (options?.recipientName?.trim()) {
      page.drawText(options.recipientName.trim(), {
        x: tableX + 6,
        y: signLineY - 38,
        size: 10,
        font,
        color: black,
      });
    }
  
    if (options?.signedAt) {
      page.drawText(`Signed on: ${this.formatDoDate(options.signedAt)}`, {
        x: tableX + 190,
        y: signLineY - 38,
        size: 9,
        font,
        color: black,
      });
    }
  
    if (job.deliveredAt || options?.signedAt) {
      page.drawText(
        `DO Date: ${this.formatDoDate(options?.signedAt ?? job.deliveredAt)}`,
        {
          x: width - 170,
          y: height - 28,
          size: 9,
          font,
          color: black,
        },
      );
    }
  
    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
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

  private drawBlockText(
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    maxHeight: number,
    font: PDFFont,
    fontSize: number,
    color: ReturnType<typeof rgb>,
    maxLines = 4,
  ) {
    const lines = this.wrapPdfTextByWidth(
      text || "-",
      maxWidth,
      fontSize,
      font,
    );
    let yy = y;
    let count = 0;

    for (const line of lines) {
      if (count >= maxLines) break;
      if (yy < y - maxHeight) break;

      page.drawText(line, {
        x,
        y: yy,
        size: fontSize,
        font,
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
  
    const paragraphs = String(text).split("\n");
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
        const candidateWidth = font.widthOfTextAtSize(candidate, fontSize);
  
        if (candidateWidth <= maxWidth) {
          current = candidate;
          continue;
        }
  
        if (current) {
          output.push(current);
        }
  
        if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
          current = word;
        } else {
          // hard break long token
          let chunk = "";
          for (const ch of word) {
            const next = chunk + ch;
            if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
              chunk = next;
            } else {
              if (chunk) output.push(chunk);
              chunk = ch;
            }
          }
          current = chunk;
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

import * as fs from "fs";
import path from "path";

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  Optional,
} from "@nestjs/common";
import {
  CollectionType,
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
  CustomerQuotationStatus,
  CustomerRateTemplateStatus,
  MembershipStatus,
  Prisma,
  Role,
  TripPendingState,
  TripDocumentType,
  TripDocumentRequirementStage,
  TripDocumentResponsibleUploader,
  TripStatus,
} from "@prisma/client";
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

import { PrismaService } from "../../shared/prisma/prisma.service";
import { actorIsCustomerAdmin } from "../../shared/auth/access-actor";
import { AuditService } from "../../shared/audit/audit.service";
import { SupabaseService } from "../../shared/auth/supabase.service";
import {
  autoTripTopologyJobType,
  sharedRouteTopologyJobType,
  resolveCreateJobTypesInput,
  resolveJobTypesForResponse,
  resolveTripTypeForResponse,
  assertTripTypeBelongsToJob,
  assertTripTypeEditableStatus,
  JOB_TYPE_IN_USE_BY_TRIP_CODE,
  JOB_TYPE_COMBINATION_UNSUPPORTED_CODE,
  normalizeJobTypes,
  jobTypesInclude,
  cargoModeForJobTypes,
  internalRefTypeCode,
  compatibilityJobTypeOrNull,
} from "./job-types";
import {
  parsePaginationFromQuery,
  buildPaginationMeta,
  type PaginatedResponse,
} from "../../shared/common/pagination";
import { buildOrderBy } from "../../shared/common/listing/listing.sort";
import { buildDocumentFileDisplayFields } from "../documents/document-file-display";
import {
  buildDocumentSignedUrlResponse,
  JOB_DOCUMENTS_BUCKET,
} from "../documents/job-document-signed-url";
import {
  buildSignedDoSignatureStorageKey,
  doFileSuffixForType,
  doStorageFolderForType,
  isSignableDoType,
  logDoSignatureDebug,
  parseSignatureContentType,
  parseSignatureImageBytes,
  parseSignedAtFromBody,
  pickPreferredSignatureArtifact,
  resolveDoSignatureEmbedInput,
  resolveUsedSignatureSource,
  signableDoHasCustomerSignature,
  signatureArtifactFallbackTypes,
  signatureArtifactTypeForDo,
  warnMissingSignatureImageForSignedDo,
  type SignableDoType,
  type SignTripDocumentBody,
} from "../documents/do-signature.helpers";
import { computeDoSignatureImageDrawRect } from "../documents/signature-pdf-layout.helpers";
import { normalizeSignatureImageForPdf } from "../documents/signature-image-normalize";
import {
  documentUploadedByInclude,
  loadUploadActorFields,
  resolveDocumentUploadedByFields,
} from "../documents/document-uploader.utils";
import { DocumentSignedUrlDto, JobListItemDto } from "./dto/job.dto";
import { buildTripDisplayRef } from "../trips/trip-display-ref";
import { suggestTripOrderByNearestNeighbour } from "../trips/trip-order-suggest";
import {
  evaluateJobInvoiceReadiness,
  assertJobHasNoTripsForCancelOrDelete,
  syncJobInvoiceReadiness,
  type JobInvoiceSyncPrisma,
} from "./job-invoice-readiness";
import {
  JOB_LIST_SORT_FIELDS,
  indexLatestInvoicesByJobId,
  jobListFilteredCountSql,
  jobListFilteredPageIdsSql,
  jobListPageInvoiceQuery,
  jobListPrismaWhere,
  tripProgressFromTrips,
  type JobListInvoiceRef,
  type JobListQueryConstraints,
  type JobListTripProgress,
} from "./job-list-progress";
import { RealtimeEventsService } from "../../shared/realtime/realtime-events.service";
import * as rt from "../../shared/realtime/realtime-publish";
import { tripDocumentTypeLabel } from "../../shared/notifications/document-type-label";
import { resolveTripDetailsNotificationKind } from "../../shared/notifications/trip-details-notification";
import {
  normalizeOptionalNotes,
  resolveTripNotesResponseFields,
} from "../trips/trip-notes.helpers";
import {
  ADMIN_VISIBLE_TRIP_DOCUMENT_TYPES,
  deriveTripDocumentStatus,
  groupTripDocumentsByTripId,
} from "../trips/trip-document-list.helpers";

import { CreateJobDto } from "./dto/create-job.dto";
import { UpdateJobDto } from "./dto/update-job.dto";
import { AssignJobDto } from "./dto/assign-job.dto";
import { CancelJobDto } from "./dto/cancel-job.dto";
import { JobListQueryDto } from "./dto/job-list-query.dto";
import {
  JobDto,
  JobDetailsDto,
  JobDocumentDto,
  JobTrackingDto,
  JobTripResponseDto,
  AuditLogEntryDto,
} from "./dto/job.dto";
import {
  buildJobContainerSummary,
  buildJobPayoutSummary,
  effectivePayoutLineTotalCents,
  tripPayoutTotalCents,
} from "./job-details-summary";
import {
  assertTripPayoutMutable,
  payoutCacheCentsToPersist,
  resolveCanonicalTripPayoutCents,
} from "../trips/trip-payout.helpers";
import { SaveJobChargesDto } from "./dto/save-job-charges.dto";
import {
  AppendJobTripDto,
  AssignJobTripDto,
  PatchTripPayoutDto,
  PatchTripDocumentRequirementDto,
  CreateTripDocumentRequirementDto,
  PatchJobTripDto,
  PatchTripDetailsDto,
  PublishJobTripRouteDto,
  ReorderJobTripsDto,
  SuggestJobTripOrderDto,
  TripPayoutLineInputDto,
} from "../trips/dto/job-trip.dto";
import {
  tripCreateManyForJob,
  completionRuleForTemplate,
  GUL_CIRCLE_ROUTE_DEFAULTS,
  jobTripTemplateDisplayLabel,
  resolveAppendTripRouteSnapshot,
  resolveTripRouteAddressResponseFields,
  isContainerCargoJobType,
  buildTripCompletionDocumentGaps,
  canonicalAutoTripCarriesCreatedJobItems,
  jobItemIdsForCanonicalAutoTrip,
} from "../workflows/job-workflow.helpers";
import {
  assertCanonicalRouteLocationsForCreate,
  canonicalAutoTripRouteSnapshots,
  resolveCanonicalRouteLocations,
} from "./job-route-locations";
import {
  documentTypeSupportsCustomerSignature,
  ensureDefaultTripDocumentRequirementSnapshots,
  isTripDocumentRequirementFrozen,
  requirementSnapshotForType,
} from "../workflows/trip-document-requirements";
import {
  aggregateJobDocumentReadiness,
  evaluateTripDocumentRequirements,
  tripDocumentRequirementDuplicateKey,
  type TripDocumentRequirementEvaluation,
} from "../workflows/trip-document-requirement-evaluation";
import {
  buildTripCargoFromLinks,
  evaluateTripPublishLinkReadiness,
  isContainerBasedTransportJob,
  normalizeJobItemIdsInput,
} from "./trip-job-item.helpers";
import {
  createTripJobItemLinksIfAbsent,
  loadTripJobItemLinks,
  replaceTripJobItemLinks,
  applyJobItemsUpdateInTransaction,
} from "./trip-job-item.mutations";
import { isUniqueConstraintError } from "../../shared/idempotency/idempotency.util";
import {
  CANONICAL_JOB_DELIVERY_DO_CONCURRENCY,
  mapWithConcurrency,
} from "./bounded-concurrency";
import {
  assertCreateJobInteractiveTxClient,
  assertPrismaInteractiveTransactionAvailable,
  CANONICAL_JOB_CREATE_TX_MAX_WAIT_MS,
  CANONICAL_JOB_CREATE_TX_TIMEOUT_MS,
} from "./create-job-interactive-tx";
import {
  applyExportDetailsPatch,
  applyImportDetailsPatch,
  applyOptionalDateNullable,
  applyOptionalTrimmedNullable,
  assertTypeSpecificDetailsMatchJobType,
  clearIncompatibleTypeSpecificJobFields,
} from "./job-type-specific-patch";
import {
  type ActiveCustomerRateTemplateRow,
  type BoundCustomerQuotationLine,
  buildCustomerQuotationChargeSnapshot,
  formatAcceptedQuotationCatalogueLabel,
  jobChargeProvenanceLabel,
  jobChargeQtyFromQuotationQty,
  mapCustomerQuotationLinesToChargeOptions,
  mapCustomerRateTemplateRowsToChargeOptions,
  normalizeOptionalId,
} from "./job-commercial-provenance";
import { reservedJobChargeMutationMessage } from "../finance/invoice-integrity";
import {
  buildContainerDocumentationRequirements,
} from "../driver-app/container-documentation.helpers";
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
import {
  assertCreateJobItemsRequiredForJobType,
  assertExportDestinationFieldsConsistent,
  collectionContainerCountForTripGeneration,
  importPickupOriginUsesAddressFields,
  parseValidJobItemsFromInput,
  parseValidUpdateJobItemsFromInput,
  readCreateJobItemsInput,
  readUpdateJobItemsInput,
  resolveCollectionTypeForJobCreate,
  resolveExportDestinationFields,
  resolveExportPickupFields,
} from "./create-job-validation.helpers";
import {
  normalizeOptionalTrimmedText,
  resolveJobDescription,
  resolveJobPickupReference,
} from "./job-field-resolution.helpers";


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
  TripDocumentType.PERMIT,
]);

const sourceCustomerQuotationSelect = {
  id: true,
  quotationNo: true,
  title: true,
  status: true,
  customerCompanyId: true,
} as const;

function normalizeExternalRef(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

const JOB_LIST_ITEM_SELECT = {
  id: true,
  tenantId: true,
  customerCompanyId: true,
  internalRef: true,
  externalRef: true,
  jobType: true,
  collectionType: true,
  status: true,
  pickupDate: true,
  createdAt: true,
  updatedAt: true,
  jobTypeAssignments: { select: { jobType: true } },
  customerCompany: { select: { name: true } },
  _count: {
    select: {
      items: true,
      trips: true,
      documents: { where: { isActive: true } },
    },
  },
  trips: {
    where: { status: { notIn: [TripStatus.DRAFT, TripStatus.CANCELLED] } },
    orderBy: [{ tripSequence: "asc" as const }, { createdAt: "asc" as const }],
    take: 1,
    select: { assignedDriverUserId: true },
  },
} as const;

function toDocumentReadinessDto(
  evaluation: TripDocumentRequirementEvaluation,
) {
  return {
    evaluationSource: evaluation.evaluationSource,
    readinessStatus: evaluation.readinessStatus,
    totalMissingCount: evaluation.totalMissingCount,
    blockingAction: evaluation.blockingAction,
    blockingActor: evaluation.blockingActor,
    missingTypeCodes: evaluation.missingTypeCodes,
    summaryLabels: evaluation.summaryLabels,
    requirements: evaluation.requirements.map((row) => ({
      requirementId: row.requirementId,
      type: row.type,
      label: row.label,
      isRequired: row.isRequired,
      minCount: row.minCount,
      satisfiedCount: row.satisfiedCount,
      missingCount: row.missingCount,
      requiresSignature: row.requiresSignature,
      signatureSatisfied: row.signatureSatisfied,
      responsibleUploader: row.responsibleUploader,
      requirementStage: row.requirementStage,
      satisfiedState: row.satisfiedState,
      blockingAction: row.blockingAction,
      blockingActor: row.blockingActor,
      blocksLifecycle: row.blocksLifecycle,
    })),
  };
}

function evaluateTripDocsFromRows(input: {
  status?: string | null;
  documents?: Array<{
    type: string;
    isActive?: boolean | null;
    isSigned?: boolean | null;
    signedAt?: Date | string | null;
    mimeType?: string | null;
    originalName?: string | null;
  }> | null;
  documentRequirements?: Array<{
    id?: string | null;
    type: string;
    label?: string | null;
    isRequired: boolean;
    requiresSignature: boolean;
    minCount?: number | null;
    sortOrder?: number | null;
    responsibleUploader?: string | null;
    requirementStage?: string | null;
  }> | null;
}): TripDocumentRequirementEvaluation {
  return evaluateTripDocumentRequirements({
    tripStatus: input.status,
    documents: (input.documents ?? []).map((document) => ({
      type: document.type,
      isActive: document.isActive !== false,
      isSigned: document.isSigned === true,
      signedAt: document.signedAt ?? null,
      mimeType: document.mimeType ?? null,
      originalName: document.originalName ?? null,
    })),
    requirements: input.documentRequirements ?? [],
  });
}

function toJobListItemDto(
  j: any,
  driverNameByUserId?: Map<string, string | null>,
  tripProgress?: JobListTripProgress,
  invoice?: JobListInvoiceRef | null,
  documentReadiness?: {
    readinessStatus: string;
    missingDocumentCount: number;
    missingLabels: string[];
    blockingActor: string;
    primaryTripId: string | null;
  },
): JobListItemDto {
  const primaryTrip = Array.isArray(j.trips) ? j.trips[0] : null;
  const assignedDriverId = primaryTrip?.assignedDriverUserId ?? null;
  const resolvedTypes = resolveJobTypesForResponse({
    assignments: j.jobTypeAssignments,
    legacyJobType: j.jobType,
  });
  return {
    id: j.id,
    tenantId: j.tenantId,
    customerCompanyId: j.customerCompanyId,
    companyName: j.customerCompany?.name ?? null,
    internalRef: j.internalRef,
    externalRef: j.externalRef ?? null,
    jobType: j.jobType,
    jobTypes: resolvedTypes.jobTypes,
    jobTypeSource: resolvedTypes.jobTypeSource,
    collectionType: j.collectionType ?? null,
    status: j.status,
    pickupDate: j.pickupDate ?? null,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    assignedDriverId,
    assignedDriverName:
      (assignedDriverId && driverNameByUserId?.get(assignedDriverId)) || null,
    tripCount: j._count?.trips ?? 0,
    itemCount: j._count?.items ?? 0,
    documentCount: j._count?.documents ?? 0,
    documentReadiness: documentReadiness ?? {
      readinessStatus: "UNAVAILABLE",
      missingDocumentCount: 0,
      missingLabels: [],
      blockingActor: "NONE",
      primaryTripId: null,
    },
    tripProgress: tripProgress ?? {
      completed: 0,
      total: 0,
      isComplete: false,
    },
    invoice: invoice
      ? { id: invoice.id, status: invoice.status }
      : null,
  };
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
    sourceCustomerQuotationId: j.sourceCustomerQuotationId ?? null,
    sourceCustomerQuotationNo: j.sourceCustomerQuotation?.quotationNo ?? null,
    sourceCustomerQuotationTitle: j.sourceCustomerQuotation?.title ?? null,

    internalRef: j.internalRef,
    externalRef: j.externalRef ?? null,
    jobType: j.jobType,
    ...(() => {
      const resolved = resolveJobTypesForResponse({
        assignments: j.jobTypeAssignments,
        legacyJobType: j.jobType,
      });
      return {
        jobTypes: resolved.jobTypes,
        jobTypeSource: resolved.jobTypeSource,
      };
    })(),
    collectionType: j.collectionType ?? null,
    status: j.status,
    invoiceReadyAt: j.invoiceReadyAt ?? null,
    isInvoiceReady: j.status === JobStatus.READY_FOR_INVOICE,
    computedInvoiceReady:
      computedReadiness?.readyForInvoice ??
      (j.status === JobStatus.READY_FOR_INVOICE ? true : trips.length > 0 ? false : undefined),
    computedInvoiceReadinessReason: computedReadiness?.reason ?? null,
    notes: j.notes ?? null,
    pickupReference: resolveJobPickupReference(
      j,
      isContainerCargoJobType(j.jobType) ? j.items : null,
    ),
    description: resolveJobDescription(j, j.items, {
      useItemFallback: isContainerCargoJobType(j.jobType),
    }),
    carrierName: j.carrierName ?? null,
    voyage: j.voyage ?? null,
    shipper: j.shipper ?? null,

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
    pickupPlaceId: primaryTrip?.originPlaceId ?? null,
    pickupLat: primaryTrip?.originLat ?? null,
    pickupLng: primaryTrip?.originLng ?? null,
    pickupContactName: j.pickupContactName,
    pickupContactPhone: j.pickupContactPhone,

    deliveryAddress1: j.deliveryAddress1,
    deliveryAddress2: j.deliveryAddress2,
    deliveryPostal: j.deliveryPostal,
    deliveryPlaceId: primaryTrip?.destinationPlaceId ?? null,
    deliveryLat: primaryTrip?.destinationLat ?? null,
    deliveryLng: primaryTrip?.destinationLng ?? null,
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
      j.items?.map((item: any) => {
        const containerStyle = isContainerCargoJobType(j.jobType);
        const sealNo = item.sealNo ?? null;
        return {
          id: item.id,
          tenantId: item.tenantId ?? j.tenantId,
          jobId: item.jobId ?? j.id,
          itemCode: item.itemCode,
          // Container rows: description/pickupReference live on the job (with read fallback).
          description: containerStyle ? null : (item.description ?? null),
          sealNo,
          sealNumber: sealNo,
          pickupReference: containerStyle ? null : (item.pickupReference ?? null),
          qty: item.qty ?? null,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }) ?? [],

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
        driverRemarks: t.driverRemarks ?? null,
        originSummary: null,
        destinationSummary: null,
        origin: null,
        destination: null,
        status: t.status,
        ...(() => {
          const parentTypes = resolveJobTypesForResponse({
            assignments: j.jobTypeAssignments,
            legacyJobType: j.jobType,
          }).jobTypes;
          const resolved = resolveTripTypeForResponse({
            tripType: t.tripType,
            parentJobTypes: parentTypes,
            legacyParentJobType: j.jobType,
          });
          return {
            tripType: resolved.tripType,
            tripTypeSource: resolved.tripTypeSource,
          };
        })(),
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
          jobType: j.jobType ?? null,
          jobItemCount: Array.isArray(j.items) ? j.items.length : (j._count?.items ?? 0),
          linkedJobItemCount:
            Array.isArray(t.tripJobItems)
              ? t.tripJobItems.length
              : (t._count?.tripJobItems ?? 0),
          jobTripTemplate: t.jobTripTemplate ?? null,
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
        documentStatus: deriveTripDocumentStatus([]),
        completionRuleJson: t.completionRuleJson ?? null,
        ...resolveTripNotesResponseFields(t, j),
        ...resolveTripRouteAddressResponseFields(t),
      })) ?? [],

    charges:
      j.charges?.map((c: any) => ({
        id: c.id,
        sourceType: c.sourceType,
        sourceRefId: c.sourceRefId ?? null,
        sourceCustomerQuotationItemId: c.sourceCustomerQuotationItemId ?? null,
        sourceCustomerQuotationLineId: c.sourceCustomerQuotationLineId ?? null,
        provenanceLabel: jobChargeProvenanceLabel({
          sourceType: c.sourceType,
          sourceCustomerQuotationLineId: c.sourceCustomerQuotationLineId ?? null,
          metadataJson: c.metadataJson,
        }),
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

type TripPublishReadinessInput = {
  status: TripStatus;
  assignedDriverUserId?: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
  fleetVehicleId?: string | null;
  driverEarningCents?: number | null;
  payoutLines?: Array<any> | null;
  /** When set, canPublish also mirrors publishTrip TripJobItem gate (no write/auto-heal). */
  jobType?: JobType | null;
  jobItemCount?: number;
  linkedJobItemCount?: number;
  jobTripTemplate?: JobTripTemplate | null;
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
  return tripPayoutTotalCents(payoutLines);
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

    return applyTripJobItemLinkPublishGate(
      {
        canPublish: true,
        errorMessage: null,
        totalPayoutCents: total,
        payoutLineCount: payoutLines.length,
      },
      input,
    );
  }

  if (!Number.isInteger(input.driverEarningCents) || (input.driverEarningCents ?? 0) <= 0) {
    return {
      canPublish: false,
      errorMessage: "Set driver payout before publishing trip.",
      totalPayoutCents: 0,
      payoutLineCount: 0,
    };
  }

  return applyTripJobItemLinkPublishGate(
    {
      canPublish: true,
      errorMessage: null,
      totalPayoutCents: input.driverEarningCents ?? 0,
      payoutLineCount: 0,
    },
    input,
  );
}

/**
 * Mirror publishTrip TripJobItem gate for canPublish/UI without writing or auto-healing.
 * Single-item auto-heal is treated as ready (publish will heal); multi unlinked is not.
 */
function applyTripJobItemLinkPublishGate(
  base: TripPublishReadinessResult,
  input: TripPublishReadinessInput,
): TripPublishReadinessResult {
  if (!base.canPublish) return base;
  if (input.jobType === undefined && input.jobItemCount === undefined) {
    return base;
  }
  const link = evaluateTripPublishLinkReadiness({
    jobType: input.jobType,
    jobItemCount: input.jobItemCount ?? 0,
    linkedJobItemCount: input.linkedJobItemCount ?? 0,
    jobTripTemplate: input.jobTripTemplate,
  });
  if (!link.required) return base;
  if (link.satisfied || link.shouldAutoHealSingleItem) return base;
  return {
    ...base,
    canPublish: false,
    errorMessage:
      link.errorMessage
      ?? "Select at least one cargo item (jobItemIds) before publishing this container-based trip.",
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

/** Job fields that change trip route snapshots when edited. */
export const TRIP_DETAILS_ROUTE_JOB_KEYS = [
  "pickupAddress1",
  "pickupAddress2",
  "pickupPostal",
  "pickupPlaceId",
  "pickupLat",
  "pickupLng",
  "deliveryAddress1",
  "deliveryAddress2",
  "deliveryPostal",
  "deliveryPlaceId",
  "deliveryLat",
  "deliveryLng",
  "returningDepotCode",
  "returnLastDay",
  "pickupPortCode",
  "exportPortCode",
  "exportOriginDepotCode",
] as const;

export const TRIP_DETAILS_CARGO_KEYS = ["items", "cargoItems"] as const;

export const TRIP_DETAILS_METADATA_JOB_KEYS = [
  "collectionType",
  "vesselName",
  "vesselEta",
] as const;

export const TRIP_DETAILS_CONTACT_JOB_KEYS = [
  "pickupContactName",
  "pickupContactPhone",
  "receiverName",
  "receiverPhone",
] as const;

export const TRIP_DETAILS_NOTES_KEYS = [
  "notes",
  "jobNotes",
  "tripInstruction",
] as const;

export const TRIP_DETAILS_TRIP_KEYS = [
  "plannedStartAt",
  "tripPICName",
  "tripPICContact",
] as const;

function dtoHasAnyDefinedKey(
  dto: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.some((k) => dto[k] !== undefined);
}

export function assertTripDetailsEditAllowed(
  tripStatus: TripStatus,
  jobStatus: JobStatus,
  dto: PatchTripDetailsDto,
): void {
  if (
    jobStatus === JobStatus.COMPLETED
    || jobStatus === JobStatus.CANCELLED
  ) {
    throw new BadRequestException(
      "Cannot edit job in COMPLETED or CANCELLED status",
    );
  }

  const raw = dto as Record<string, unknown>;
  const hasRoute = dtoHasAnyDefinedKey(raw, TRIP_DETAILS_ROUTE_JOB_KEYS);
  const hasCargo = dtoHasAnyDefinedKey(raw, TRIP_DETAILS_CARGO_KEYS);
  const hasMetadata = dtoHasAnyDefinedKey(raw, TRIP_DETAILS_METADATA_JOB_KEYS);
  const hasContact = dtoHasAnyDefinedKey(raw, TRIP_DETAILS_CONTACT_JOB_KEYS);
  const hasNotes = dtoHasAnyDefinedKey(raw, TRIP_DETAILS_NOTES_KEYS);
  const hasTripFields = dtoHasAnyDefinedKey(raw, TRIP_DETAILS_TRIP_KEYS);

  if (tripStatus === TripStatus.CANCELLED) {
    throw new BadRequestException("Cannot edit a CANCELLED trip");
  }

  if (isTerminalStatus(tripStatus)) {
    const allowedOnly =
      (hasNotes || hasTripFields)
      && !hasRoute
      && !hasCargo
      && !hasMetadata
      && !hasContact;
    if (!allowedOnly) {
      throw new BadRequestException(
        "Completed trips only allow notes and trip contact/timing corrections",
      );
    }
    if (hasTripFields && raw.plannedStartAt !== undefined) {
      throw new BadRequestException(
        "Cannot change plannedStartAt on a completed trip",
      );
    }
    return;
  }

  if (tripStatus === TripStatus.ONGOING) {
    if (hasRoute) {
      throw new BadRequestException(
        "Cannot change pickup/delivery route while trip is ONGOING",
      );
    }
    if (hasCargo) {
      throw new BadRequestException(
        "Cannot change cargo items while trip is ONGOING",
      );
    }
    if (hasMetadata) {
      throw new BadRequestException(
        "Cannot change vessel/collection metadata while trip is ONGOING",
      );
    }
  }
}

function resolveTripDetailsJobNotesInput(
  dto: PatchTripDetailsDto,
): string | null | undefined {
  if (dto.jobNotes !== undefined) return dto.jobNotes;
  if (dto.tripInstruction !== undefined) return dto.tripInstruction;
  return undefined;
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
      sourceRateMasterItemId: line.earningRateMasterId ?? line.payoutItemId ?? null,
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
    case JobTripTemplate.PICKUP_TO_DELIVERY: {
      const importUsesAddressOrigin =
        job?.jobType === JobType.IMPORT
        && importPickupOriginUsesAddressFields({
          pickupAddress1: job?.pickupAddress1,
          pickupPostal: job?.pickupPostal,
        });
      const importOriginLabel = importUsesAddressOrigin
        ? (pickupAddress ?? null)
        : (portLabel ?? pickupAddress ?? null);
      const importOriginType = importUsesAddressOrigin
        ? (pickupAddress ? "PICKUP" : null)
        : (portLabel ? "PORT" : pickupAddress ? "PICKUP" : null);
      return {
        fromLabel:
          job?.jobType === JobType.IMPORT
            ? importOriginLabel
            : pickupAddress ?? "Pickup location",
        toLabel: deliveryAddress ?? "Delivery location",
        fromAddress:
          job?.jobType === JobType.IMPORT ? importOriginLabel : pickupAddress,
        toAddress: deliveryAddress,
        fromType:
          job?.jobType === JobType.IMPORT ? importOriginType : "PICKUP",
        toType: "DELIVERY",
      };
    }
    case JobTripTemplate.DELIVERY_TO_DEPOT:
      return {
        fromLabel: deliveryAddress ?? "Delivery location",
        toLabel: returnDepotLabel ?? null,
        fromAddress: deliveryAddress,
        toAddress: returnDepotLabel ?? null,
        fromType: "DELIVERY",
        toType: returnDepotLabel ? "DEPOT" : null,
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
    case JobTripTemplate.PORT_TO_DEPOT:
      return {
        fromLabel: portLabel ?? "Port",
        toLabel: exportDepotLabel ?? "Origin depot",
        fromAddress: portLabel,
        toAddress: exportDepotLabel,
        fromType: portLabel ? "PORT" : null,
        toType: exportDepotLabel ? "DEPOT" : null,
      };
    case JobTripTemplate.CUSTOMER_TO_GUL:
      return {
        fromLabel: deliveryAddress ?? pickupAddress ?? "Customer site",
        toLabel: GUL_CIRCLE_ROUTE_DEFAULTS.summary,
        fromAddress: deliveryAddress ?? pickupAddress,
        toAddress: GUL_CIRCLE_ROUTE_DEFAULTS.summary,
        fromType: deliveryAddress ? "DELIVERY" : pickupAddress ? "PICKUP" : null,
        toType: "GUL",
      };
    case JobTripTemplate.GUL_TO_CUSTOMER:
      return {
        fromLabel: GUL_CIRCLE_ROUTE_DEFAULTS.summary,
        toLabel: deliveryAddress ?? pickupAddress ?? "Customer site",
        fromAddress: GUL_CIRCLE_ROUTE_DEFAULTS.summary,
        toAddress: deliveryAddress ?? pickupAddress,
        fromType: "GUL",
        toType: deliveryAddress ? "DELIVERY" : pickupAddress ? "PICKUP" : null,
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
export class TransportJobsService {
  private readonly logger = new Logger(TransportJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly supabaseService: SupabaseService,
    @Optional() private readonly realtime?: RealtimeEventsService,
  ) {}

  private notifyActorContext(user: any): {
    actorUserId?: string;
    actorRole?: Role;
  } {
    return {
      actorUserId: user?.userId ?? undefined,
      actorRole: user?.role as Role | undefined,
    };
  }

  private getCustomerCompanyIdOrThrow(user: any): string {
    if (!actorIsCustomerAdmin(user)) {
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
    if (actorIsCustomerAdmin(user)) {
      where.customerCompanyId = this.getCustomerCompanyIdOrThrow(user);
    }
    return where;
  }

  assertCanAccessJob(job: any, user: any) {
    if (!actorIsCustomerAdmin(user)) return;
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
                type: { in: ADMIN_VISIBLE_TRIP_DOCUMENT_TYPES },
              },
              select: {
                type: true,
                generatedBySystem: true,
                isSigned: true,
              },
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

  private async assertAcceptedSourceQuotation(
    tenantId: string,
    customerCompanyId: string,
    quotationId: string,
  ) {
    const quotation = await this.prisma.customerQuotation.findFirst({
      where: { id: quotationId, tenantId },
      select: {
        id: true,
        customerCompanyId: true,
        status: true,
      },
    });
    if (!quotation) {
      throw new BadRequestException("Customer quotation not found");
    }
    if (quotation.customerCompanyId !== customerCompanyId) {
      throw new BadRequestException(
        "Customer quotation does not belong to this customer",
      );
    }
    if (quotation.status !== CustomerQuotationStatus.ACCEPTED) {
      throw new BadRequestException(
        "Job commercial agreement must be an ACCEPTED customer quotation",
      );
    }
    return quotation;
  }

  private async persistJobCharges(
    tenantId: string,
    jobId: string,
    dto: SaveJobChargesDto,
    selectedByUserId: string | null,
  ): Promise<void> {
    const now = new Date();
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      select: {
        id: true,
        customerCompanyId: true,
        sourceCustomerQuotationId: true,
      },
    });
    if (!job) throw new NotFoundException("Job not found");

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.jobCharge.findMany({
        where: { tenantId, jobId },
      });
      const reservedIds = new Set<string>();
      if (existing.length && tx.invoiceChargeReservation) {
        const reservations = await tx.invoiceChargeReservation.findMany({
          where: {
            tenantId,
            jobChargeId: { in: existing.map((c) => c.id) },
          },
          select: { jobChargeId: true },
        });
        for (const row of reservations) reservedIds.add(row.jobChargeId);
      }
      const incomingById = new Map(
        dto.charges
          .filter((c) => typeof c.id === "string" && c.id.trim())
          .map((c) => [c.id!.trim(), c]),
      );
      for (const reserved of existing.filter((c) => reservedIds.has(c.id))) {
        const incoming = incomingById.get(reserved.id);
        if (!incoming) {
          throw new BadRequestException(
            reservedJobChargeMutationMessage(reserved.label),
          );
        }
        if (
          incoming.qty !== reserved.qty ||
          incoming.unitPriceCents !== reserved.unitPriceCents ||
          incoming.label !== reserved.label ||
          incoming.code !== reserved.code
        ) {
          throw new BadRequestException(
            reservedJobChargeMutationMessage(reserved.label),
          );
        }
      }
      if (reservedIds.size === 0) {
        await tx.jobCharge.deleteMany({ where: { tenantId, jobId } });
      } else {
        await tx.jobCharge.deleteMany({
          where: { tenantId, jobId, id: { notIn: [...reservedIds] } },
        });
      }
      const mutableCharges = dto.charges.filter(
        (c) => !c.id || !reservedIds.has(c.id),
      );
      if (!mutableCharges.length) return;

      const quotationLineIds = dto.charges
        .filter((c) => c.sourceType === JobChargeSourceType.CUSTOMER_QUOTATION)
        .map((c) => normalizeOptionalId(c.sourceCustomerQuotationLineId));
      const uniqueLineIds = [
        ...new Set(quotationLineIds.filter((id): id is string => !!id)),
      ];

      const templateRowIds = dto.charges
        .filter(
          (c) =>
            c.sourceType === JobChargeSourceType.MANUAL &&
            typeof c.sourceRefId === "string" &&
            c.sourceRefId.trim().length > 0,
        )
        .map((c) => c.sourceRefId!.trim());

      if (uniqueLineIds.length > 0 && templateRowIds.length > 0) {
        throw new BadRequestException(
          "Cannot mix accepted quotation lines with legacy customer rate template lines in one save",
        );
      }

      let effectiveBoundQuotationId = job.sourceCustomerQuotationId;
      if (uniqueLineIds.length > 0 && !effectiveBoundQuotationId) {
        const candidateLines = await tx.customerQuotationLine.findMany({
          where: {
            tenantId,
            id: { in: uniqueLineIds },
          },
          include: {
            quotation: {
              select: {
                id: true,
                quotationNo: true,
                title: true,
                status: true,
                customerCompanyId: true,
              },
            },
          },
        });
        if (candidateLines.length !== uniqueLineIds.length) {
          throw new BadRequestException(
            "One or more quotation lines were not found for this tenant",
          );
        }
        const quotationIds = new Set(
          candidateLines.map((line) => line.quotationId),
        );
        if (quotationIds.size !== 1) {
          throw new BadRequestException(
            "CUSTOMER_QUOTATION charges must come from a single accepted quotation",
          );
        }
        const acceptedQuotation = candidateLines[0]!.quotation;
        if (
          !acceptedQuotation ||
          acceptedQuotation.customerCompanyId !== job.customerCompanyId ||
          acceptedQuotation.status !== CustomerQuotationStatus.ACCEPTED
        ) {
          throw new BadRequestException(
            "Quotation lines must belong to an ACCEPTED customer quotation",
          );
        }
        await tx.job.update({
          where: { id: jobId, tenantId },
          data: { sourceCustomerQuotationId: acceptedQuotation.id },
        });
        effectiveBoundQuotationId = acceptedQuotation.id;
      } else if (
        quotationLineIds.some((id) => id) &&
        !effectiveBoundQuotationId
      ) {
        throw new BadRequestException(
          "Job has no bound accepted quotation for CUSTOMER_QUOTATION charges",
        );
      }

      const quotationLines = uniqueLineIds.length
        ? await tx.customerQuotationLine.findMany({
            where: {
              tenantId,
              id: { in: uniqueLineIds },
              quotationId: effectiveBoundQuotationId ?? undefined,
            },
            include: {
              quotation: {
                select: {
                  id: true,
                  quotationNo: true,
                  title: true,
                  status: true,
                  customerCompanyId: true,
                },
              },
            },
          })
        : [];
      const quotationLineById = new Map<string, BoundCustomerQuotationLine>(
        quotationLines.map((line) => [line.id, line as BoundCustomerQuotationLine]),
      );

      if (uniqueLineIds.length > 0) {
        for (const lineId of uniqueLineIds) {
          if (!quotationLineById.has(lineId)) {
            throw new BadRequestException(
              "Quotation line does not belong to the job's bound quotation",
            );
          }
        }
        const boundQuotation = quotationLines[0]?.quotation;
        if (
          !boundQuotation ||
          boundQuotation.id !== effectiveBoundQuotationId ||
          boundQuotation.customerCompanyId !== job.customerCompanyId ||
          boundQuotation.status !== CustomerQuotationStatus.ACCEPTED
        ) {
          throw new BadRequestException(
            "Quotation lines must belong to this job's ACCEPTED commercial agreement",
          );
        }
        for (const c of dto.charges) {
          if (c.sourceType !== JobChargeSourceType.CUSTOMER_QUOTATION) continue;
          const lineId = normalizeOptionalId(c.sourceCustomerQuotationLineId);
          if (!lineId) continue;
          const line = quotationLineById.get(lineId)!;
          if (
            line.requiresManualAmount &&
            (!Number.isInteger(c.unitPriceCents) || c.unitPriceCents <= 0)
          ) {
            throw new BadRequestException(
              `Manual amount is required for quotation item "${line.label}" before saving charges`,
            );
          }
        }
      }

      if (effectiveBoundQuotationId && templateRowIds.length > 0) {
        throw new BadRequestException(
          "Legacy customer rate template lines are not allowed on a quotation-bound job",
        );
      }

      const templateRows = templateRowIds.length
        ? await tx.customerRateTemplateRow.findMany({
            where: {
              tenantId,
              id: { in: [...new Set(templateRowIds)] },
              isActive: true,
              template: {
                tenantId,
                customerCompanyId: job.customerCompanyId,
                status: CustomerRateTemplateStatus.ACTIVE,
              },
            },
            include: { template: { select: { id: true, name: true } } },
          })
        : [];
      const templateRowById = new Map<string, ActiveCustomerRateTemplateRow>(
        templateRows.map((row) => [row.id, row as ActiveCustomerRateTemplateRow]),
      );

      await tx.jobCharge.createMany({
        // unitPriceCents/amountCents are frozen snapshots; later quotation/template edits do not rewrite saved charges.
        data: mutableCharges.map((c, i) => {
          const qty = jobChargeQtyFromQuotationQty(c.qty);
          if (c.sourceType === JobChargeSourceType.CUSTOMER_QUOTATION) {
            const lineId = normalizeOptionalId(c.sourceCustomerQuotationLineId);
            if (!lineId) {
              // Historical CUSTOMER_QUOTATION rows used master sourceRefId.
              // Re-save them as frozen snapshots; do not treat sourceRefId as a CustomerQuotationLine id.
              return {
                tenantId,
                jobId,
                sourceType: JobChargeSourceType.CUSTOMER_QUOTATION,
                sourceRefId: c.sourceRefId ?? null,
                sourceCustomerQuotationItemId: null,
                sourceCustomerQuotationLineId: null,
                code: c.code,
                label: c.label,
                description: c.description ?? null,
                qty,
                unitPriceCents: c.unitPriceCents,
                amountCents: qty * c.unitPriceCents,
                currency: c.currency ?? "SGD",
                taxable: c.taxable ?? true,
                taxCode: c.taxCode ?? null,
                taxRateBasisPoints: c.taxRateBasisPoints ?? null,
                metadataJson: null,
                sortOrder: c.sortOrder ?? i,
                selectedByUserId: selectedByUserId ?? null,
                overrideReason: c.overrideReason ?? null,
                updatedAt: now,
              };
            }
            const line = quotationLineById.get(lineId)!;
            const snapshot = buildCustomerQuotationChargeSnapshot({
              line,
              quotation: line.quotation,
              qty,
              unitPriceCents: c.unitPriceCents,
              capturedAt: now,
            });
            return {
              tenantId,
              jobId,
              ...snapshot,
              metadataJson: snapshot.metadataJson as Prisma.InputJsonValue,
              sortOrder: c.sortOrder ?? i,
              selectedByUserId: selectedByUserId ?? null,
              overrideReason: c.overrideReason ?? null,
              updatedAt: now,
            };
          }

          const templateRow =
            c.sourceType === JobChargeSourceType.MANUAL && c.sourceRefId
              ? templateRowById.get(c.sourceRefId)
              : null;
          return {
            tenantId,
            jobId,
            sourceType: c.sourceType,
            sourceRefId: c.sourceRefId ?? null,
            sourceCustomerQuotationItemId: null,
            sourceCustomerQuotationLineId: null,
            code: templateRow?.code ?? c.code,
            label: templateRow?.label ?? c.label,
            description: templateRow?.description ?? c.description ?? null,
            qty,
            unitPriceCents: c.unitPriceCents,
            amountCents: qty * c.unitPriceCents,
            currency: c.currency ?? "SGD",
            taxable: c.taxable ?? true,
            taxCode: c.taxCode ?? null,
            taxRateBasisPoints: c.taxRateBasisPoints ?? null,
            metadataJson: templateRow
              ? ({
                  customerRateTemplateSnapshot: {
                    templateId: templateRow.template.id,
                    templateName: templateRow.template.name,
                    rowId: templateRow.id,
                    code: templateRow.code,
                    label: templateRow.label,
                    capturedAt: now.toISOString(),
                  },
                } as Prisma.InputJsonValue)
              : null,
            sortOrder: c.sortOrder ?? i,
            selectedByUserId: selectedByUserId ?? null,
            overrideReason: c.overrideReason ?? null,
            updatedAt: now,
          };
        }),
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
    if (!actorIsCustomerAdmin(user)) return;
    this.getCustomerCompanyIdOrThrow(user);
    throw new ForbiddenException(
      `CUSTOMER_ADMIN users are read-only for job and trip documents`,
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
      case JobType.COLLECTION:
        return "COL";
      default:
        return "GEN";
    }
  }

  /** Prefix for newly allocated job internal refs (e.g. WFL-2026-05-0001-LCL). */
  private static readonly JOB_INTERNAL_REF_PREFIX = "WFL";

  private async getNextInternalRef(
    tenantId: string,
    jobTypes: readonly JobType[] | JobType,
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
    const types = Array.isArray(jobTypes) ? jobTypes : [jobTypes];
    const typeCode = internalRefTypeCode(types);
    return `${TransportJobsService.JOB_INTERNAL_REF_PREFIX}-${yyyy}-${MM}-${seq}-${typeCode}`;
  }

  /** Metadata only — no Supabase round-trip. */
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
    const signedUrl = await buildDocumentSignedUrlResponse(
      this.supabaseService.getClient(),
      doc.storageKey,
      doc.tenantId,
    );
    return {
      ...base,
      url: signedUrl.previewUrl,
      downloadUrl: signedUrl.downloadUrl,
      previewUrl: signedUrl.previewUrl,
    };
  }

  async getJobDocumentSignedUrl(
    tenantId: string,
    jobId: string,
    documentId: string,
    user: any,
  ): Promise<DocumentSignedUrlDto> {
    const job = await this.prisma.job.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException("Job not found");
    this.assertCanAccessJob(job, user);

    const doc = await this.prisma.jobDocument.findFirst({
      where: { id: documentId, tenantId, jobId, isActive: true },
    });
    if (!doc) throw new NotFoundException("Document not found");

    return buildDocumentSignedUrlResponse(
      this.supabaseService.getClient(),
      doc.storageKey,
      tenantId,
    );
  }

  async getTripDocumentSignedUrl(
    tenantId: string,
    jobId: string,
    tripId: string,
    documentId: string,
    user: any,
  ): Promise<DocumentSignedUrlDto> {
    const job = await this.prisma.job.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException("Job not found");
    this.assertCanAccessJob(job, user);

    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
    });
    if (!trip) throw new NotFoundException("Trip not found");

    const doc = await this.prisma.tripDocument.findFirst({
      where: { id: documentId, tenantId, tripId, isActive: true },
    });
    if (!doc) throw new NotFoundException("Document not found");

    if (isSignableDoType(doc.type)) {
      await this.refreshSignedDoPdf(tenantId, jobId, tripId, doc.type);
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

  private async downloadJobDocumentBytes(
    storageKey: string,
  ): Promise<Buffer | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .storage.from(JOB_DOCUMENTS_BUCKET)
      .download(storageKey);

    if (error || !data) {
      console.warn(
        `[TransportJobsService] Failed to download job document ${storageKey}: ${error?.message ?? "no data"}`,
      );
      return null;
    }

    return Buffer.from(await data.arrayBuffer());
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
        `[TransportJobsService] Failed to remove storage object ${storageKey}: ${error.message}`,
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

  private resolveRouteGeo(
    prefix: "pickup" | "delivery",
    trip: any,
    snapshotRole: "origin" | "destination",
    options?: {
      pickupLat?: number | null;
      pickupLng?: number | null;
      pickupPlaceId?: string | null;
      deliveryLat?: number | null;
      deliveryLng?: number | null;
      deliveryPlaceId?: string | null;
    },
  ): { lat: number | null; lng: number | null; placeId: string | null } {
    const latOpt = prefix === "pickup" ? options?.pickupLat : options?.deliveryLat;
    const lngOpt = prefix === "pickup" ? options?.pickupLng : options?.deliveryLng;
    const placeOpt =
      prefix === "pickup" ? options?.pickupPlaceId : options?.deliveryPlaceId;
    return {
      lat: latOpt !== undefined ? (latOpt ?? null) : (trip?.[`${snapshotRole}Lat`] ?? null),
      lng: lngOpt !== undefined ? (lngOpt ?? null) : (trip?.[`${snapshotRole}Lng`] ?? null),
      placeId:
        placeOpt !== undefined
          ? (String(placeOpt ?? "").trim() || null)
          : (trip?.[`${snapshotRole}PlaceId`] ?? null),
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
    options?: {
      pickupLat?: number | null;
      pickupLng?: number | null;
      pickupPlaceId?: string | null;
      deliveryLat?: number | null;
      deliveryLng?: number | null;
      deliveryPlaceId?: string | null;
      /** When set, only trips in these statuses are updated (e.g. DRAFT/PUBLISHED). */
      tripStatuses?: TripStatus[];
    },
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
      if (
        options?.tripStatuses?.length
        && !options.tripStatuses.includes(trip.status as TripStatus)
      ) {
        continue;
      }
      let origin: any = null;
      let destination: any = null;
      if (trip.jobTripTemplate === JobTripTemplate.PICKUP_TO_DELIVERY) {
        const pickupGeo = this.resolveRouteGeo("pickup", trip, "origin", options);
        const deliveryGeo = this.resolveRouteGeo("delivery", trip, "destination", options);
        if (job.jobType === JobType.LCL || job.jobType === JobType.COLLECTION) {
          origin = this.buildAddressSnapshot(
            job.pickupAddress1 ?? "Pickup location",
            job,
            "pickup",
            pickupGeo,
          );
        } else if (job.jobType === JobType.EXPORT) {
          origin = this.buildAddressSnapshot(
            job.pickupAddress1 ?? "Pickup location",
            job,
            "pickup",
            pickupGeo,
          );
        } else if (job.jobType === JobType.IMPORT) {
          const useAddressOrigin = importPickupOriginUsesAddressFields({
            pickupAddress1: job.pickupAddress1,
            pickupPostal: job.pickupPostal,
            pickupPlaceId: pickupGeo.placeId,
            pickupLat: pickupGeo.lat,
            pickupLng: pickupGeo.lng,
          });
          origin = useAddressOrigin || !pickupPort
            ? this.buildAddressSnapshot(
                job.pickupAddress1 ?? "Pickup location",
                job,
                "pickup",
                pickupGeo,
              )
            : this.locationSnapshotFromMaster(pickupPort);
        } else {
          origin = this.locationSnapshotFromMaster(pickupPort);
        }
        destination = this.buildAddressSnapshot(
          job.deliveryAddress1 ?? "Delivery location",
          job,
          "delivery",
          deliveryGeo,
        );
      } else if (trip.jobTripTemplate === JobTripTemplate.DELIVERY_TO_DEPOT) {
        const deliveryAsOriginGeo = this.resolveRouteGeo("delivery", trip, "origin", options);
        origin = this.buildAddressSnapshot(
          job.deliveryAddress1 ?? "Delivery location",
          job,
          "delivery",
          deliveryAsOriginGeo,
        );
        destination = this.locationSnapshotFromMaster(returnDepot);
      } else if (trip.jobTripTemplate === JobTripTemplate.DEPOT_TO_DELIVERY) {
        origin =
          this.locationSnapshotFromMaster(exportOriginDepot) ??
          this.buildAddressSnapshot(
            job.pickupAddress1 ?? "Empty container depot",
            job,
            "pickup",
            this.resolveRouteGeo("pickup", trip, "origin", options),
          );
        destination = this.buildAddressSnapshot(
          job.deliveryAddress1 ?? "Stuffing destination",
          job,
          "delivery",
          this.resolveRouteGeo("delivery", trip, "destination", options),
        );
      } else if (trip.jobTripTemplate === JobTripTemplate.DELIVERY_TO_PORT) {
        origin = this.buildAddressSnapshot(
          job.deliveryAddress1 ?? "Stuffing destination",
          job,
          "delivery",
          this.resolveRouteGeo("delivery", trip, "origin", options),
        );
        destination = this.locationSnapshotFromMaster(exportPort);
      } else if (trip.jobTripTemplate === JobTripTemplate.PORT_TO_DEPOT) {
        origin = this.locationSnapshotFromMaster(exportPort);
        destination =
          this.locationSnapshotFromMaster(exportOriginDepot) ??
          this.buildAddressSnapshot(
            job.pickupAddress1 ?? "Empty container depot",
            job,
            "pickup",
            this.resolveRouteGeo("pickup", trip, "destination", options),
          );
      }
      const routeData: Record<string, unknown> = {};
      if (origin) {
        routeData.originLocationId = origin.locationId ?? null;
        routeData.originLabel = origin.label ?? null;
        routeData.originAddressLine1 = origin.addressLine1 ?? null;
        routeData.originAddressLine2 = origin.addressLine2 ?? null;
        routeData.originPostalCode = origin.postalCode ?? null;
        routeData.originCountry = origin.country ?? null;
        routeData.originLat = origin.lat ?? null;
        routeData.originLng = origin.lng ?? null;
        routeData.originPlaceId = origin.placeId ?? null;
      }
      if (destination) {
        routeData.destinationLocationId = destination.locationId ?? null;
        routeData.destinationLabel = destination.label ?? null;
        routeData.destinationAddressLine1 = destination.addressLine1 ?? null;
        routeData.destinationAddressLine2 = destination.addressLine2 ?? null;
        routeData.destinationPostalCode = destination.postalCode ?? null;
        routeData.destinationCountry = destination.country ?? null;
        routeData.destinationLat = destination.lat ?? null;
        routeData.destinationLng = destination.lng ?? null;
        routeData.destinationPlaceId = destination.placeId ?? null;
      }
      if (Object.keys(routeData).length === 0) continue;
      await this.prisma.trip.update({
        where: { id: trip.id },
        data: routeData,
      });
    }
  }

  private buildJobListConstraints(
    tenantId: string,
    query: JobListQueryDto,
    user: any,
  ): JobListQueryConstraints {
    const access = this.applyJobAccessFilter(tenantId, user);
    return {
      tenantId,
      companyScopeId: actorIsCustomerAdmin(user)
        ? access.customerCompanyId
        : query.companyId?.trim() || undefined,
      search: (query.q ?? query.search)?.trim() || undefined,
      jobStatus: query.status?.trim() || undefined,
      legacyFilter: query.filter?.trim() || undefined,
      jobType: query.jobType?.trim() || undefined,
      tripProgress: query.tripProgress,
      invoiceStatus: query.invoiceStatus,
      date: query.date?.trim() || undefined,
      dateFrom:
        query.dateFrom?.trim() || query.pickupDateFrom?.trim() || undefined,
      dateTo: query.dateTo?.trim() || query.pickupDateTo?.trim() || undefined,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    };
  }

  async list(
    tenantId: string,
    query: JobListQueryDto,
    user: any,
  ): Promise<PaginatedResponse<JobListItemDto>> {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query);
    const constraints = this.buildJobListConstraints(tenantId, query, user);
    const where = jobListPrismaWhere(constraints);
    const orderBy = buildOrderBy(
      query.sortBy,
      query.sortDir,
      JOB_LIST_SORT_FIELDS,
      { createdAt: "desc" },
    );

    let total: number;
    let jobs: any[];
    if (constraints.invoiceStatus) {
      const [countRows, idRows] = await Promise.all([
        this.prisma.$queryRaw(jobListFilteredCountSql(constraints)) as Promise<
          Array<{ count: bigint }>
        >,
        this.prisma.$queryRaw(
          jobListFilteredPageIdsSql(constraints, skip, take),
        ) as Promise<Array<{ id: string }>>,
      ]);
      total = Number(countRows[0]?.count ?? 0);
      const pageIds = idRows.map((row) => row.id);
      const unordered = pageIds.length
        ? await this.prisma.job.findMany({
            where: {
              AND: [
                this.applyJobAccessFilter(tenantId, user),
                { id: { in: pageIds } },
              ],
            },
            select: JOB_LIST_ITEM_SELECT,
          })
        : [];
      const byId = new Map(unordered.map((job) => [job.id, job]));
      jobs = pageIds
        .map((id) => byId.get(id))
        .filter((job): job is NonNullable<typeof job> => Boolean(job));
    } else {
      const [count, rows] = await this.prisma.$transaction([
        this.prisma.job.count({ where }),
        this.prisma.job.findMany({
          where,
          orderBy,
          skip,
          take,
          select: JOB_LIST_ITEM_SELECT,
        }),
      ]);
      total = count;
      jobs = rows;
    }

    const jobIds = jobs.map((job) => job.id);
    const [driverNameMap, tripRows, pageInvoices, readinessTripRows] =
      await Promise.all([
      this.buildUserNameMapByIds(
        tenantId,
        Array.from(
          new Set(
            jobs
              .map((j) => j.trips?.[0]?.assignedDriverUserId)
              .filter(Boolean) as string[],
          ),
        ),
      ),
      jobIds.length
        ? this.prisma.trip.findMany({
            where: { tenantId, jobId: { in: jobIds } },
            select: { jobId: true, status: true },
          })
        : Promise.resolve([]),
      jobIds.length
        ? this.prisma.invoice.findMany(jobListPageInvoiceQuery(tenantId, jobIds))
        : Promise.resolve([]),
      jobIds.length
        ? this.prisma.trip.findMany({
            where: { tenantId, jobId: { in: jobIds } },
            select: {
              id: true,
              jobId: true,
              status: true,
              documents: {
                where: { isActive: true },
                select: {
                  type: true,
                  isActive: true,
                  isSigned: true,
                  signedAt: true,
                  mimeType: true,
                  originalName: true,
                },
              },
              documentRequirements: {
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                select: {
                  id: true,
                  type: true,
                  label: true,
                  isRequired: true,
                  requiresSignature: true,
                  minCount: true,
                  sortOrder: true,
                  responsibleUploader: true,
                  requirementStage: true,
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const tripsByJobId = new Map<string, Array<{ status: TripStatus }>>();
    for (const trip of tripRows) {
      const list = tripsByJobId.get(trip.jobId) ?? [];
      list.push({ status: trip.status });
      tripsByJobId.set(trip.jobId, list);
    }

    const readinessByJobId = new Map<
      string,
      {
        readinessStatus: string;
        missingDocumentCount: number;
        missingLabels: string[];
        blockingActor: string;
        primaryTripId: string | null;
      }
    >();
    const readinessTripsByJob = new Map<string, typeof readinessTripRows>();
    for (const trip of readinessTripRows) {
      const list = readinessTripsByJob.get(trip.jobId) ?? [];
      list.push(trip);
      readinessTripsByJob.set(trip.jobId, list);
    }
    for (const [jobId, trips] of readinessTripsByJob.entries()) {
      const evaluations = trips.map((trip) =>
        evaluateTripDocsFromRows({
          status: trip.status,
          documents: trip.documents,
          documentRequirements: trip.documentRequirements,
        }),
      );
      const rollup = aggregateJobDocumentReadiness(evaluations);
      const firstBlocking = trips.find((trip, index) => {
        const evaluation = evaluations[index];
        return (
          evaluation &&
          !evaluation.cancelled &&
          evaluation.totalMissingCount > 0
        );
      });
      readinessByJobId.set(jobId, {
        ...rollup,
        primaryTripId: firstBlocking?.id ?? null,
      });
    }

    const invoiceByJobId = indexLatestInvoicesByJobId(pageInvoices);

    return {
      data: jobs.map((j) =>
        toJobListItemDto(
          j,
          driverNameMap,
          tripProgressFromTrips(tripsByJobId.get(j.id) ?? []),
          invoiceByJobId.get(j.id) ?? null,
          readinessByJobId.get(j.id),
        ),
      ),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async create(
    tenantId: string,
    dto: CreateJobDto,
    user: any,
  ): Promise<JobDto> {
    const created = await this.createCanonicalJob(tenantId, dto, user);
    return this.finalizeCanonicalJobCreate(tenantId, dto, user, created);
  }

  /**
   * Canonical Job creation (validation + Job/JobItems + automatic Trips + links).
   * Manual Create Job and AI import confirm both use this. When `tx` is supplied,
   * writes join the caller's interactive transaction; post-commit effects are skipped.
   */
  async createCanonicalJob(
    tenantId: string,
    dto: CreateJobDto,
    user: any,
    options?: {
      tx?: any;
      perf?: {
        measure<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
      };
    },
  ): Promise<{ id: string; internalRef: string | null }> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: dto.customerCompanyId, tenantId },
    });

    if (!company) {
      throw new BadRequestException("Customer company not found");
    }

    const sourceCustomerQuotationId = normalizeOptionalId(
      dto.sourceCustomerQuotationId,
    );
    if (sourceCustomerQuotationId) {
      await this.assertAcceptedSourceQuotation(
        tenantId,
        dto.customerCompanyId,
        sourceCustomerQuotationId,
      );
    }

    const typeResolution = resolveCreateJobTypesInput({
      jobTypes: (dto as any).jobTypes,
      jobType: dto.jobType,
      type: (dto as any).type,
    });
    if (typeResolution.ok === false) {
      const Ex =
        typeResolution.code === JOB_TYPE_COMBINATION_UNSUPPORTED_CODE
          ? ConflictException
          : BadRequestException;
      throw new Ex({
        code: typeResolution.code,
        message: typeResolution.message,
      });
    }
    const resolvedJobTypes = typeResolution.jobTypes;
    // Compatibility singular only when exactly one type; multi-type → null (never first-of-array).
    const compatibilityJobType = typeResolution.compatibilityJobType;
    const includesImport = jobTypesInclude(resolvedJobTypes, JobType.IMPORT);
    const includesExport = jobTypesInclude(resolvedJobTypes, JobType.EXPORT);
    const includesCollection = jobTypesInclude(
      resolvedJobTypes,
      JobType.COLLECTION,
    );
    // Pure EXPORT (single-type) still remaps stuffing addresses; multi-type does not invent EXPORT topology.
    const pureExport = compatibilityJobType === JobType.EXPORT;

    const rawItems = readCreateJobItemsInput(dto);
    const validItems = parseValidJobItemsFromInput(
      rawItems,
      compatibilityJobType,
      resolvedJobTypes,
    );
    assertCreateJobItemsRequiredForJobType(
      compatibilityJobType,
      rawItems,
      validItems,
    );
    const collectionType = resolveCollectionTypeForJobCreate(
      resolvedJobTypes,
      dto.collectionType,
    );

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
    const vesselName = (
      dto.vesselName ?? importDetails.vesselName ?? exportDetails.vesselName
    )?.trim();
    const vesselEta =
      dto.vesselEta ?? importDetails.vesselEta ?? exportDetails.vesselEta;
    const portnetReady =
      dto.portnetReady ?? importDetails.portnetReady ?? false;
    const permitReady = dto.permitReady ?? importDetails.permitReady ?? false;
    const returningDepotCodeInput =
      pureExport
        ? null
        : (
            dto.returningDepotCode ?? importDetails.returningDepotCode
          )?.trim();
    const returningDepotCode =
      pureExport
        ? null
        : returningDepotCodeInput ??
          (await this.resolveLogisticsCodeFromId(
            returningDepotId,
            LogisticsLocationType.DEPOT,
          ));
    const returnLastDay =
      pureExport
        ? null
        : dto.returnLastDay ?? importDetails.returnLastDay;
    const exportOriginDepotCodeInput = (
      dto.exportOriginDepotCode ??
      exportDetails.pickupDepotCode ??
      exportDetails.exportOriginDepotCode
    )?.trim();
    const exportOriginDepotCode =
      exportOriginDepotCodeInput ??
      (await this.resolveLogisticsCodeFromId(
        exportDetails.pickupDepotId,
        LogisticsLocationType.DEPOT,
      ));
    const exportPortCodeInput = (
      dto.exportPortCode ?? exportDetails.exportPortCode
    )?.trim();
    const exportPortCode =
      exportPortCodeInput ??
      (await this.resolveLogisticsCodeFromId(
        exportDetails.exportPortId,
        LogisticsLocationType.PORT,
      ));
    const legacyContainerPickupAddress1 =
      exportDetails.containerPickupAddress1?.trim();
    const legacyContainerPickupAddress2 =
      exportDetails.containerPickupAddress2?.trim();
    const legacyContainerPickupPostal =
      exportDetails.containerPickupPostal?.trim();
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

    if (includesImport) {
      const portCode = pickupPortCode?.trim();
      if (portCode) {
        const port = await this.prisma.masterLogisticsLocation.findFirst({
          where: { code: portCode, type: LogisticsLocationType.PORT, isActive: true },
        });
        if (!port) {
          throw new BadRequestException(`Unknown pickupPortCode: ${portCode}`);
        }
      }
      if (returningDepotCode) {
        const returnDepotForImport = await this.prisma.masterLogisticsLocation.findFirst({
          where: {
            code: returningDepotCode,
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
    }

    const exportPickup = resolveExportPickupFields({
      pickupAddress1: dto.pickupAddress1,
      pickupAddress2: dto.pickupAddress2,
      pickupPostal: dto.pickupPostal,
      containerPickupAddress1: legacyContainerPickupAddress1,
      containerPickupAddress2: legacyContainerPickupAddress2,
      containerPickupPostal: legacyContainerPickupPostal,
    });

    if (pureExport) {
      assertExportDestinationFieldsConsistent({
        deliveryAddress1: dto.deliveryAddress1,
        deliveryAddress2: dto.deliveryAddress2,
        deliveryPostal: dto.deliveryPostal,
        stuffingAddress1: exportDetails.stuffingAddress1,
        stuffingAddress2: exportDetails.stuffingAddress2,
        stuffingPostal: exportDetails.stuffingPostal,
      });

      if (exportOriginDepotCode) {
        const pickupDepot = await this.prisma.masterLogisticsLocation.findFirst({
          where: {
            code: exportOriginDepotCode,
            type: LogisticsLocationType.DEPOT,
            isActive: true,
          },
        });
        if (!pickupDepot) {
          throw new BadRequestException(
            `Unknown export pickup depot code: ${exportOriginDepotCode}`,
          );
        }
      }
    }

    // Membership-based shared topology for supported multi (IMPORT|EXPORT + COLLECTION).
    // Never invent from jobTypes[0] / compatibility null → first type.
    const routeTopologyType = sharedRouteTopologyJobType(resolvedJobTypes);
    if (!routeTopologyType) {
      throw new ConflictException({
        code: JOB_TYPE_COMBINATION_UNSUPPORTED_CODE,
        message:
          "Job type combination cannot safely share the current job-level cargo/route structure.",
      });
    }

    const routeLocations = resolveCanonicalRouteLocations({
      jobType: routeTopologyType,
      pickupAddress1:
        pureExport ? exportPickup.address1 : dto.pickupAddress1,
      pickupAddress2:
        pureExport ? exportPickup.address2 : dto.pickupAddress2,
      pickupPostal:
        pureExport ? exportPickup.postal : dto.pickupPostal,
      pickupPlaceId: dto.pickupPlaceId,
      pickupLat: dto.pickupLat,
      pickupLng: dto.pickupLng,
      pickupContactName: dto.pickupContactName,
      pickupContactPhone: dto.pickupContactPhone,
      pickupPortCode,
      deliveryAddress1:
        pureExport
          ? stuffingAddress1 ?? dto.deliveryAddress1
          : dto.deliveryAddress1,
      deliveryAddress2:
        pureExport
          ? stuffingAddress2 ?? dto.deliveryAddress2
          : dto.deliveryAddress2,
      deliveryPostal:
        pureExport
          ? stuffingPostal ?? dto.deliveryPostal
          : dto.deliveryPostal,
      deliveryPlaceId: dto.deliveryPlaceId,
      deliveryLat: dto.deliveryLat,
      deliveryLng: dto.deliveryLng,
      receiverName: stuffingContactName ?? dto.receiverName,
      receiverPhone: stuffingContactPhone ?? dto.receiverPhone,
      exportDetails: {
        ...exportDetails,
        containerPickupAddress1: legacyContainerPickupAddress1,
        containerPickupAddress2: legacyContainerPickupAddress2,
        containerPickupPostal: legacyContainerPickupPostal,
        stuffingAddress1,
        stuffingAddress2,
        stuffingPostal,
        stuffingContactName,
        stuffingContactPhone,
        exportOriginDepotCode,
        exportPortCode,
      },
      importDetails: {
        ...importDetails,
        pickupPortCode,
        returningDepotCode,
      },
      returningDepotCode,
      exportPortCode,
      exportOriginDepotCode,
    });
    assertCanonicalRouteLocationsForCreate(routeTopologyType, routeLocations);

    const internalRef = await this.getNextInternalRef(tenantId, resolvedJobTypes);

    const pickupDateParsed = dto.pickupDate ? new Date(dto.pickupDate) : null;

    // Cargo/shipping defaults are applied inside tripCreateManyForJob only for IMPORT/EXPORT; LCL legs are skipped.
    const seededContainerNumber = String(dto.containerNumber ?? "").trim() || null;
    const seededShippingRefs = {
      carrier: null as string | null,
      shipper: null as string | null,
      vessel: String(vesselName ?? "").trim() || null,
    };
    // Auto-trip snapshots only when exactly one type; multi-type skips inventing topology.
    const autoTripTopology = autoTripTopologyJobType(resolvedJobTypes);
    const autoTripRouteSnapshots = autoTripTopology
      ? canonicalAutoTripRouteSnapshots(autoTripTopology, routeLocations)
      : {};

    // Atomic: job + JobItems + auto trips + TripJobItem links (or full rollback).
    // Fail closed: never fall back to non-transactional or root-client writes.
    if (options?.tx) {
      assertCreateJobInteractiveTxClient(options.tx);
    } else {
      assertPrismaInteractiveTransactionAvailable(this.prisma as any);
    }

    const createJobWithTripsAndLinks = async (tx: any) => {
      assertCreateJobInteractiveTxClient(tx);

      const createdJob = await tx.job.create({
        data: {
          tenantId,
          customerCompanyId: dto.customerCompanyId,
          sourceCustomerQuotationId: sourceCustomerQuotationId ?? null,
          internalRef,
          externalRef: normalizeExternalRef(dto.externalRef),
          jobType: compatibilityJobType,
          collectionType,
          status: JobStatus.ONGOING,
          notes: dto.notes ?? null,
          pickupReference: normalizeOptionalTrimmedText(dto.pickupReference),
          description: normalizeOptionalTrimmedText(dto.description),
          carrierName: normalizeOptionalTrimmedText(dto.carrierName),
          voyage: normalizeOptionalTrimmedText(dto.voyage),
          shipper: normalizeOptionalTrimmedText(dto.shipper),
          createdByUserId: actorUserId,
          pickupDate: pickupDateParsed,
          pickupAddress1:
            pureExport
              ? exportPickup.address1
              : (dto.pickupAddress1?.trim() || ""),
          pickupAddress2:
            pureExport
              ? exportPickup.address2
              : (dto.pickupAddress2 ?? null),
          pickupPostal:
            pureExport
              ? exportPickup.postal
              : (dto.pickupPostal ?? null),
          pickupContactName: dto.pickupContactName ?? null,
          pickupContactPhone: dto.pickupContactPhone ?? null,
          deliveryAddress1:
            pureExport
              ? (stuffingAddress1 ?? dto.deliveryAddress1)
              : dto.deliveryAddress1,
          deliveryAddress2:
            pureExport
              ? (stuffingAddress2 ?? null)
              : (dto.deliveryAddress2 ?? null),
          deliveryPostal:
            pureExport
              ? (stuffingPostal ?? null)
              : (dto.deliveryPostal ?? null),
          receiverName:
            pureExport
              ? (stuffingContactName ?? dto.receiverName ?? "")
              : (dto.receiverName ?? ""),
          receiverPhone:
            pureExport
              ? (stuffingContactPhone ?? dto.receiverPhone ?? "")
              : (dto.receiverPhone ?? ""),
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
        },
        include: {
          customerCompany: {
            select: { id: true, name: true },
          },
          assignedDriver: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      await tx.jobTypeAssignment.createMany({
        data: resolvedJobTypes.map((jobType) => ({
          tenantId,
          jobId: createdJob.id,
          jobType,
        })),
        skipDuplicates: true,
      });

      // Create JobItems in submit order so duplicate (itemCode, sealNo) rows keep
      // distinct identities for per-container COLLECTION trip linking.
      const createdItemIds: string[] = [];
      for (const item of validItems) {
        const createdItem = await tx.jobItem.create({
          data: {
            tenantId,
            jobId: createdJob.id,
            itemCode: item.itemCode,
            description: item.description,
            sealNo: item.sealNo,
            pickupReference: item.pickupReference,
            qty: item.qty,
          },
        });
        createdItemIds.push(createdItem.id);
      }

      const createTripsAndLinks = async () => {
        const topologyType = autoTripTopologyJobType(resolvedJobTypes);
        if (!topologyType) {
          // Multi-type job: do not invent auto-trip topology from the first type.
          return;
        }
        await tx.trip.createMany({
          data: tripCreateManyForJob(
            tenantId,
            createdJob.id,
            topologyType,
            pickupDateParsed,
            seededContainerNumber,
            seededShippingRefs,
            autoTripRouteSnapshots,
            {
              createdByUserId: actorUserId,
              collectionContainerCount: collectionContainerCountForTripGeneration(
                topologyType,
                validItems,
              ),
              tripType: topologyType,
            },
          ),
        });

        const createdTripsInTx = await tx.trip.findMany({
          where: { tenantId, jobId: createdJob.id },
          orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            status: true,
            containerNumber: true,
            jobTripTemplate: true,
            tripSequence: true,
          },
        });

        // TripJobItem is cargo authority. Link per cargo-movement model
        // (jobItemIdsForCanonicalAutoTrip) — not cartesian across all legs.
        if (createdItemIds.length > 0) {
          for (const trip of createdTripsInTx) {
            const linkIds = jobItemIdsForCanonicalAutoTrip({
              jobType: topologyType,
              jobTripTemplate: trip.jobTripTemplate,
              jobItemIds: createdItemIds,
              tripSequence: trip.tripSequence,
            });
            if (linkIds.length === 0) continue;
            await createTripJobItemLinksIfAbsent(tx, {
              tenantId,
              tripId: trip.id,
              jobId: createdJob.id,
              tripStatus: trip.status,
              previousContainerNumber: trip.containerNumber,
              jobItemIds: linkIds,
              linkedByUserId: actorUserId,
            });
          }
        }

        await ensureDefaultTripDocumentRequirementSnapshots(
          tx,
          tenantId,
          createdTripsInTx.map((trip: { id: string }) => trip.id),
        );
      };

      await (options?.perf
        ? options.perf.measure("canonicalJobCreate.tripsAndLinks", () =>
            createTripsAndLinks(),
          )
        : createTripsAndLinks());

      return createdJob;
    };

    const job = options?.tx
      ? await createJobWithTripsAndLinks(options.tx)
      : await this.prisma.$transaction(createJobWithTripsAndLinks, {
          maxWait: CANONICAL_JOB_CREATE_TX_MAX_WAIT_MS,
          timeout: CANONICAL_JOB_CREATE_TX_TIMEOUT_MS,
        });

    return { id: job.id, internalRef: job.internalRef ?? null };
  }

  async finalizeCanonicalJobCreate(
    tenantId: string,
    dto: CreateJobDto,
    user: any,
    created: { id: string; internalRef: string | null },
    options?: {
      omitHttpPayload?: boolean;
      tolerateSideEffectFailures?: boolean;
      onSideEffectWarning?: (warning: {
        code: "POST_CREATE_FINALIZATION_INCOMPLETE";
        jobId: string;
        operation: string;
      }) => void;
      perf?: {
        measure<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
      };
    },
  ): Promise<JobDto> {
    const actorUserId: string | null = user?.userId ?? null;
    const jobId = created.id;
    const measure = async <T>(name: string, fn: () => T | Promise<T>): Promise<T> =>
      options?.perf ? options.perf.measure(name, fn) : fn();
    const tolerate = options?.tolerateSideEffectFailures === true;
    const warn = (operation: string, error?: unknown) => {
      const detail =
        error && typeof error === "object" && "message" in error
          ? String((error as { message?: unknown }).message ?? error)
          : error;
      console.error(
        `[TransportJobsService] Post-create ${operation} failed for job ${jobId}:`,
        detail ?? "unknown error",
      );
      options?.onSideEffectWarning?.({
        code: "POST_CREATE_FINALIZATION_INCOMPLETE",
        jobId,
        operation,
      });
    };
    const runSideEffect = async (
      operation: string,
      fn: () => Promise<unknown>,
    ): Promise<void> => {
      try {
        await fn();
      } catch (error) {
        if (!tolerate) throw error;
        warn(operation, error);
      }
    };

    const createdTrips = await this.prisma.trip.findMany({
      where: { tenantId, jobId },
      orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }],
      select: { id: true, status: true, containerNumber: true },
    });

    await measure("documentSnapshots", () =>
      runSideEffect("DOCUMENT_SNAPSHOTS", () =>
        ensureDefaultTripDocumentRequirementSnapshots(
          this.prisma,
          tenantId,
          createdTrips.map((trip) => trip.id),
        ),
      ),
    );

    await measure("createAudit", () =>
      runSideEffect("CREATE_AUDIT", async () => {
        const alreadyLogged =
          typeof this.prisma.auditLog?.findFirst === "function"
            ? await this.prisma.auditLog.findFirst({
                where: {
                  tenantId,
                  entityType: "JOB",
                  entityId: jobId,
                  action: "CREATE",
                },
                select: { id: true },
              })
            : null;
        if (alreadyLogged) return;
        await this.audit.log(
          tenantId,
          "CREATE",
          "JOB",
          jobId,
          {
            createdByUserId: actorUserId,
            internalRef: created.internalRef,
            externalRef: normalizeExternalRef(dto.externalRef),
          },
          actorUserId,
        );
      }),
    );

    if ((this.prisma as any).masterLogisticsLocation) {
      await measure("routeSnapshot", () =>
        runSideEffect("ROUTE_SNAPSHOT", () =>
          this.syncTripRouteSnapshotForJob(tenantId, jobId, {
            pickupLat: dto.pickupLat ?? null,
            pickupLng: dto.pickupLng ?? null,
            pickupPlaceId: dto.pickupPlaceId ?? null,
            deliveryLat: dto.deliveryLat ?? null,
            deliveryLng: dto.deliveryLng ?? null,
            deliveryPlaceId: dto.deliveryPlaceId ?? null,
          }),
        ),
      );
    }

    await measure("invoiceReadiness", () =>
      runSideEffect("INVOICE_READINESS", () =>
        this.syncJobInvoiceReadinessForJob(tenantId, jobId),
      ),
    );

    // Best-effort: auto-generate trip-level DELIVERY_DO for each created trip.
    // Post-commit side effect: storage/PDF failure is logged and does not roll back Jobs.
    // Import confirm skips HTTP hydration; load Job once for all trip DOs.
    // Manual create keeps hydrate-after-DO so the response includes new documents.
    const doJob =
      options?.omitHttpPayload && createdTrips.length > 0
        ? await this.prisma.job.findFirst({
            where: { id: jobId, tenantId },
            include: {
              customerCompany: true,
              assignedDriver: true,
              items: { orderBy: { createdAt: "asc" } },
            },
          })
        : null;

    const existingDoTripIds = new Set<string>();
    if (createdTrips.length && typeof this.prisma.tripDocument?.findMany === "function") {
      const existingDos = await this.prisma.tripDocument.findMany({
        where: {
          tenantId,
          tripId: { in: createdTrips.map((trip) => trip.id) },
          type: TripDocumentType.DELIVERY_DO,
          isActive: true,
        },
        select: { tripId: true },
      });
      for (const row of existingDos) {
        if (row?.tripId) existingDoTripIds.add(String(row.tripId));
      }
    }

    await mapWithConcurrency(
      createdTrips,
      CANONICAL_JOB_DELIVERY_DO_CONCURRENCY,
      async (trip: { id: string }) => {
        if (existingDoTripIds.has(trip.id)) return;
        try {
          await measure(`deliveryDo:${trip.id}`, () =>
            this.generateTripDeliveryDoDocument(
              tenantId,
              jobId,
              trip.id,
              user,
              "AUTO_CREATE_JOB",
              doJob,
            ),
          );
        } catch (error: any) {
          warn("DELIVERY_DO", error);
        }
      },
    );

    if (options?.omitHttpPayload) {
      await measure("realtime", () =>
        runSideEffect("REALTIME", async () => {
          rt.publishJobEvent(this.realtime, "job.created", tenantId, jobId, {
            jobInternalRef: created.internalRef,
            customerCompanyName: doJob?.customerCompany?.name ?? undefined,
          });
        }),
      );
      return { id: jobId, internalRef: created.internalRef } as JobDto;
    }

    const freshJob = await this.prisma.job.findFirst({
        where: { id: jobId, tenantId },
        include: {
          customerCompany: {
            select: { id: true, name: true },
          },
          sourceCustomerQuotation: {
            select: sourceCustomerQuotationSelect,
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
              _count: { select: { tripJobItems: true } },
            },
          },
          charges: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          documents: {
            where: { isActive: true },
            orderBy: { createdAt: "desc" },
            include: documentUploadedByInclude,
          },
        },
      });

    if (!freshJob) {
      throw new NotFoundException("Job not found after creation");
    }

    const jobDto = toJobDto(freshJob);
    await this.attachTripAssignedDriverNamesForJobs(tenantId, [jobDto]);

    if (freshJob.documents?.length) {
      try {
        jobDto.documents = await measure("signedUrls", () =>
          Promise.all(freshJob.documents.map((doc: any) => this.attachSignedUrl(doc))),
        );
      } catch (error) {
        if (!tolerate) throw error;
        warn("SIGNED_URLS", error);
      }
    }

    await measure("realtime", () =>
      runSideEffect("REALTIME", async () => {
        rt.publishJobEvent(this.realtime, "job.created", tenantId, freshJob.id, {
          jobInternalRef: freshJob.internalRef,
          customerCompanyName: freshJob.customerCompany?.name ?? undefined,
        });
      }),
    );

    return jobDto;
  }

  async getOne(tenantId: string, jobId: string, user: any): Promise<JobDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      include: {
        customerCompany: {
          select: { id: true, name: true },
        },
        sourceCustomerQuotation: {
          select: sourceCustomerQuotationSelect,
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
            _count: { select: { tripJobItems: true } },
          },
        },
        charges: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        documents: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          include: documentUploadedByInclude,
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

    if (job.documents?.length) {
      dto.documents = job.documents.map((doc: any) => this.toDocumentMetadataDto(doc));
    }

    await this.attachTripDocumentsToJobDto(tenantId, dto);

    return dto;
  }

  async getDetails(
    tenantId: string,
    jobId: string,
    user: any,
  ): Promise<JobDetailsDto> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      include: {
        customerCompany: { select: { id: true, name: true } },
        sourceCustomerQuotation: {
          select: sourceCustomerQuotationSelect,
        },
        assignedDriver: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        jobTypeAssignments: { select: { jobType: true } },
        items: { orderBy: { createdAt: "asc" } },
        charges: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        documents: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          include: documentUploadedByInclude,
        },
        trips: {
          orderBy: [{ tripSequence: "asc" }, { createdAt: "asc" }],
          include: {
            drivers: { select: { id: true, name: true, email: true } },
            vehicles: { select: { id: true, plateNo: true, type: true } },
            fleetVehicle: { select: { id: true, plateNo: true, type: true } },
            payoutLines: {
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            },
            tripJobItems: {
              select: {
                id: true,
                jobItemId: true,
                containerNumberSnapshot: true,
              },
            },
            documents: {
              where: {
                isActive: true,
                type: { in: ADMIN_VISIBLE_TRIP_DOCUMENT_TYPES },
              },
              orderBy: { createdAt: "desc" },
              include: documentUploadedByInclude,
            },
            documentRequirements: {
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              select: {
                id: true,
                type: true,
                label: true,
                isRequired: true,
                requiresSignature: true,
                minCount: true,
                sortOrder: true,
                responsibleUploader: true,
                requirementStage: true,
              },
            },
            _count: { select: { stops: true, tripJobItems: true } },
          },
        },
      },
    });

    if (!job) throw new NotFoundException("Job not found");
    this.assertCanAccessJob(job, user);

    const driverNameMap = await this.buildUserNameMapByIds(
      tenantId,
      Array.from(
        new Set(
          job.trips
            .map((trip) => trip.assignedDriverUserId)
            .filter((id): id is string => Boolean(id)),
        ),
      ),
    );

    const tripDisplayRefById = new Map<string, string>(
      job.trips.map((trip): [string, string] => [
        trip.id,
        buildTripDisplayRef({
          jobInternalRef: job.internalRef,
          tripSequence: trip.tripSequence,
          jobSequence: trip.jobSequence,
          tripId: trip.id,
        }),
      ]),
    );

    const payoutSummary = buildJobPayoutSummary(job.trips);
    const containerSummary = buildJobContainerSummary(
      job.items,
      job.trips,
      tripDisplayRefById,
    );
    const coreJob = toJobDto(job);
    coreJob.trips = undefined;
    coreJob.documents = job.documents.map((document) =>
      this.toDocumentMetadataDto(document),
    );

    const trips = job.trips.map((trip) => {
      const payoutLines = trip.payoutLines.map((line) => ({
        id: line.id,
        sourceType: line.sourceType,
        payoutItemId: line.payoutItemId ?? null,
        earningRateMasterId: line.earningRateMasterId ?? null,
        code: line.code ?? null,
        label: line.label,
        description: line.description ?? null,
        unit: line.unit ?? null,
        quantity: line.quantity,
        amountCents: line.amountCents ?? null,
        totalCents: line.totalCents ?? null,
        effectiveTotalCents: effectivePayoutLineTotalCents(line),
        isManual: line.isManual,
        requiresManualAmount: line.requiresManualAmount,
        isSelectableForTripEarning: line.isSelectableForTripEarning,
        sortOrder: line.sortOrder,
      }));

      const route = deriveTripRouteSummaryFromJobAndTemplate(job, trip);
      const itemById = new Map<string, { itemCode?: string | null }>();
      for (const item of (job.items ?? []) as Array<{ id: string; itemCode?: string | null }>) {
        if (item?.id) itemById.set(item.id, item);
      }
      const cargoLabels = (trip.tripJobItems ?? [])
        .map((link: { jobItemId: string; containerNumberSnapshot?: string | null }) => {
          const item = itemById.get(link.jobItemId);
          return String(item?.itemCode ?? "").trim()
            || String(link.containerNumberSnapshot ?? "").trim()
            || "";
        })
        .filter(Boolean);

      return {
        id: trip.id,
        tripDisplayRef: tripDisplayRefById.get(trip.id) ?? trip.id,
        tripSequence: trip.tripSequence ?? null,
        jobSequence: trip.jobSequence ?? null,
        displayTitle: trip.displayTitle ?? trip.title ?? null,
        status: trip.status,
        assignedDriverUserId: trip.assignedDriverUserId ?? null,
        driverId: trip.driverId ?? null,
        assignedDriverName:
          (trip.assignedDriverUserId
            ? driverNameMap.get(trip.assignedDriverUserId)
            : null) ??
          trip.drivers?.name ??
          null,
        assignedVehiclePlateNo:
          trip.fleetVehicle?.plateNo ?? trip.vehicles?.plateNo ?? null,
        plannedStartAt: trip.plannedStartAt ?? null,
        startedAt: trip.startedAt ?? null,
        closedAt: trip.closedAt ?? null,
        stopCount: trip._count?.stops ?? 0,
        containerCount: trip._count?.tripJobItems ?? trip.tripJobItems?.length ?? 0,
        payoutTotalCents: tripPayoutTotalCents(trip.payoutLines),
        payoutLines,
        documents: (trip.documents ?? []).map((document) =>
          this.toDocumentMetadataDto(document),
        ),
        fromLabel: route.fromLabel,
        toLabel: route.toLabel,
        pendingState: trip.pendingState ?? null,
        jobTripTemplate: trip.jobTripTemplate ?? null,
        cargoLabels,
        ...(() => {
          const parentTypes = resolveJobTypesForResponse({
            assignments: job.jobTypeAssignments,
            legacyJobType: job.jobType,
          }).jobTypes;
          const resolvedTripType = resolveTripTypeForResponse({
            tripType: trip.tripType,
            parentJobTypes: parentTypes,
            legacyParentJobType: job.jobType,
          });
          const evaluation = evaluateTripDocsFromRows({
            status: trip.status,
            documents: trip.documents,
            documentRequirements: trip.documentRequirements,
          });
          return {
            tripType: resolvedTripType.tripType,
            tripTypeSource: resolvedTripType.tripTypeSource,
            incompleteDocumentCount: evaluation.totalMissingCount,
            documentReadiness: toDocumentReadinessDto(evaluation),
          };
        })(),
      };
    });

    return {
      job: coreJob,
      payoutSummary,
      containerSummary,
      trips,
    };
  }

  private async attachTripDocumentsToJobDto(
    tenantId: string,
    dto: JobDto,
  ): Promise<void> {
    const tripIds = (dto.trips ?? []).map((trip) => trip.id).filter(Boolean);
    if (!tripIds.length) return;

    const tripDocs = await this.prisma.tripDocument.findMany({
      where: {
        tenantId,
        tripId: { in: tripIds },
        isActive: true,
        type: { in: ADMIN_VISIBLE_TRIP_DOCUMENT_TYPES },
      },
      orderBy: { createdAt: "desc" },
      include: documentUploadedByInclude,
    });
    const docsByTripId = groupTripDocumentsByTripId(tripDocs);

    dto.trips = (dto.trips ?? []).map((trip) => {
      const rawDocs = docsByTripId.get(trip.id) ?? [];
      return {
        ...trip,
        documents: rawDocs.map((doc) => this.toDocumentMetadataDto(doc)),
        documentStatus: deriveTripDocumentStatus(
          rawDocs as Array<{
            type?: string;
            generatedBySystem?: boolean | null;
            isSigned?: boolean | null;
          }>,
        ),
      };
    });
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

    const nextCustomerCompanyId =
      dto.customerCompanyId !== undefined
        ? dto.customerCompanyId
        : job.customerCompanyId;
    const customerChanging =
      dto.customerCompanyId !== undefined &&
      dto.customerCompanyId !== job.customerCompanyId;
    const requestedQuotationId = normalizeOptionalId(
      dto.sourceCustomerQuotationId,
    );

    const data: any = {};

    let nextJobTypes: JobType[] | null = null;
    let nextCompat: JobType | null | undefined = undefined;
    if (dto.jobTypes !== undefined || dto.jobType !== undefined) {
      const typeResolution = resolveCreateJobTypesInput({
        jobTypes: dto.jobTypes,
        jobType: dto.jobType,
      });
      if (typeResolution.ok === false) {
        const Ex =
          typeResolution.code === JOB_TYPE_COMBINATION_UNSUPPORTED_CODE
            ? ConflictException
            : BadRequestException;
        throw new Ex({
          code: typeResolution.code,
          message: typeResolution.message,
        });
      }
      nextJobTypes = typeResolution.jobTypes;
      nextCompat = typeResolution.compatibilityJobType;
    }

    const currentTypes = resolveJobTypesForResponse({
      assignments: await this.prisma.jobTypeAssignment.findMany({
        where: { tenantId, jobId },
        select: { jobType: true },
      }),
      legacyJobType: job.jobType,
    }).jobTypes;
    const effectiveTypes = nextJobTypes ?? currentTypes;

    // Type-specific detail validation uses membership, not first-of-array.
    if (jobTypesInclude(effectiveTypes, JobType.IMPORT)) {
      assertTypeSpecificDetailsMatchJobType(JobType.IMPORT, dto);
    }
    if (jobTypesInclude(effectiveTypes, JobType.EXPORT)) {
      assertTypeSpecificDetailsMatchJobType(JobType.EXPORT, dto);
    }
    if (
      effectiveTypes.length === 1 &&
      effectiveTypes[0] === JobType.LCL
    ) {
      assertTypeSpecificDetailsMatchJobType(JobType.LCL, dto);
    }
    if (
      effectiveTypes.length === 1 &&
      effectiveTypes[0] === JobType.COLLECTION
    ) {
      assertTypeSpecificDetailsMatchJobType(JobType.COLLECTION, dto);
    }

    if (nextJobTypes) {
      data.jobType = nextCompat ?? null;
      const prevCompat = job.jobType;
      if (nextCompat !== prevCompat && nextCompat != null) {
        clearIncompatibleTypeSpecificJobFields(data, nextCompat);
      }
      if (!jobTypesInclude(nextJobTypes, JobType.COLLECTION)) {
        data.collectionType = null;
      }
    } else if (dto.jobType !== undefined) {
      data.jobType = dto.jobType;
      if (dto.jobType !== job.jobType && dto.jobType != null) {
        clearIncompatibleTypeSpecificJobFields(data, dto.jobType);
      }
      if (dto.jobType !== JobType.COLLECTION) {
        data.collectionType = null;
      }
    }
    if (dto.collectionType !== undefined) {
      if (jobTypesInclude(effectiveTypes, JobType.COLLECTION)) {
        data.collectionType = dto.collectionType;
      }
    }
    if (
      jobTypesInclude(effectiveTypes, JobType.COLLECTION)
      && !jobTypesInclude(currentTypes, JobType.COLLECTION)
      && dto.collectionType == null
      && data.collectionType === undefined
    ) {
      throw new BadRequestException(
        "collectionType is required when adding COLLECTION to job types (EMPTY or LOADED)",
      );
    }
    if (dto.customerCompanyId !== undefined) {
      data.customerCompanyId = dto.customerCompanyId;
    }
    if (requestedQuotationId !== undefined) {
      if (requestedQuotationId) {
        await this.assertAcceptedSourceQuotation(
          tenantId,
          nextCustomerCompanyId,
          requestedQuotationId,
        );
        data.sourceCustomerQuotationId = requestedQuotationId;
      } else {
        data.sourceCustomerQuotationId = null;
      }
    } else if (customerChanging) {
      data.sourceCustomerQuotationId = null;
    }
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.pickupReference !== undefined) {
      data.pickupReference = normalizeOptionalTrimmedText(dto.pickupReference);
    }
    if (dto.description !== undefined) {
      data.description = normalizeOptionalTrimmedText(dto.description);
    }
    if (dto.carrierName !== undefined) {
      data.carrierName = normalizeOptionalTrimmedText(dto.carrierName);
    }
    if (dto.voyage !== undefined) {
      data.voyage = normalizeOptionalTrimmedText(dto.voyage);
    }
    if (dto.shipper !== undefined) {
      data.shipper = normalizeOptionalTrimmedText(dto.shipper);
    }
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

    applyOptionalTrimmedNullable(data, "pickupPortCode", dto.pickupPortCode);
    applyOptionalTrimmedNullable(data, "portTerminalCode", dto.portTerminalCode);
    applyOptionalTrimmedNullable(data, "portName", dto.portName);
    applyOptionalDateNullable(
      data,
      "psaStorageRentLastDay",
      dto.psaStorageRentLastDay,
    );
    applyOptionalTrimmedNullable(data, "vesselName", dto.vesselName);
    applyOptionalDateNullable(data, "vesselEta", dto.vesselEta);
    if (dto.portnetReady !== undefined) data.portnetReady = dto.portnetReady;
    if (dto.permitReady !== undefined) data.permitReady = dto.permitReady;
    applyOptionalTrimmedNullable(
      data,
      "returningDepotCode",
      dto.returningDepotCode,
    );
    applyOptionalDateNullable(data, "returnLastDay", dto.returnLastDay);
    applyOptionalTrimmedNullable(
      data,
      "exportOriginDepotCode",
      dto.exportOriginDepotCode,
    );
    applyOptionalTrimmedNullable(data, "exportPortCode", dto.exportPortCode);

    if (dto.importDetails) {
      applyImportDetailsPatch(data, dto.importDetails);
    }
    if (dto.exportDetails) {
      applyExportDetailsPatch(data, dto.exportDetails);
    }

    const inputItems = readUpdateJobItemsInput(dto as {
      items?: unknown;
      cargoItems?: unknown;
    });

    if (nextJobTypes) {
      const currentTypes = resolveJobTypesForResponse({
        assignments: await this.prisma.jobTypeAssignment.findMany({
          where: { tenantId, jobId },
          select: { jobType: true },
        }),
        legacyJobType: job.jobType,
      }).jobTypes;
      const removed = currentTypes.filter((t) => !nextJobTypes!.includes(t));
      if (removed.length > 0) {
        const blocking = await this.prisma.trip.findFirst({
          where: {
            tenantId,
            jobId,
            tripType: { in: removed },
            status: { not: TripStatus.CANCELLED },
          },
          select: { id: true, tripType: true, status: true },
        });
        if (blocking?.tripType) {
          throw new ConflictException({
            code: JOB_TYPE_IN_USE_BY_TRIP_CODE,
            message: `Cannot remove job type ${blocking.tripType}: used by an active trip`,
          });
        }
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedJob = await tx.job.update({
        where: { id: jobId },
        data,
      });

      if (nextJobTypes) {
        await tx.jobTypeAssignment.deleteMany({
          where: { tenantId, jobId },
        });
        await tx.jobTypeAssignment.createMany({
          data: nextJobTypes.map((jobType) => ({
            tenantId,
            jobId,
            jobType,
          })),
          skipDuplicates: true,
        });
      }

      if (inputItems !== null) {
        const validItems = parseValidUpdateJobItemsFromInput(
          inputItems,
          nextCompat ??
            compatibilityJobTypeOrNull(effectiveTypes) ??
            undefined,
          effectiveTypes,
        );
        assertCreateJobItemsRequiredForJobType(
          nextCompat ?? compatibilityJobTypeOrNull(effectiveTypes),
          inputItems,
          validItems,
        );
        await applyJobItemsUpdateInTransaction(tx as any, {
          tenantId,
          jobId,
          validItems,
          // Job-level PATCH items replaces the cargo set when sent.
          replaceItems: true,
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

    rt.publishJobEvent(this.realtime, "job.updated", tenantId, jobId);

    const jobRouteFieldsChanged = Object.keys(data).some((k) =>
      (TRIP_DETAILS_ROUTE_JOB_KEYS as readonly string[]).includes(k),
    );
    if (jobRouteFieldsChanged) {
      await this.syncTripRouteSnapshotForJob(tenantId, jobId, {
        tripStatuses: [TripStatus.DRAFT, TripStatus.PUBLISHED],
      });
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

    rt.publishJobEvent(this.realtime, "job.updated", tenantId, jobId, {
      driverUserId: dto.driverId,
    });

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
    const tripCount =
      (job as any)._count?.trips ??
      (await this.prisma.trip.count({ where: { tenantId, jobId } }));
    assertJobHasNoTripsForCancelOrDelete(tripCount);

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

    rt.publishJobEvent(this.realtime, "job.cancelled", tenantId, jobId, {
      reason: dto.reason,
    });

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

    assertJobHasNoTripsForCancelOrDelete((job as any)._count?.trips ?? 0);

    const canDelete =
      job.status === JobStatus.ONGOING &&
      !job.startedAt &&
      !job.assignedDriverId;

    if (!canDelete) {
      throw new BadRequestException(
        "Job cannot be deleted; cancel it with a reason.",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.jobCharge.deleteMany({ where: { tenantId, jobId } });
      await tx.jobDocument.deleteMany({ where: { tenantId, jobId } });
      await tx.jobItem.deleteMany({ where: { tenantId, jobId } });
      await tx.job.delete({ where: { id: jobId } });
    });

    await this.audit.log(tenantId, "DELETE", "JOB", jobId, {}, actorUserId);
    rt.publishJobEvent(this.realtime, "job.deleted", tenantId, jobId);
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

    if (job.jobType === JobType.LCL || job.jobType === JobType.COLLECTION) {
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

    const uploadActor = await loadUploadActorFields(this.prisma, actorUserId, user);
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
        ...uploadActor,
      },
      include: documentUploadedByInclude,
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

    rt.publishDocumentEvent(this.realtime, "document.uploaded", tenantId, doc.id, {
      jobId,
    });

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

    const uploadActor = await loadUploadActorFields(this.prisma, actorUserId, user);
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
        ...uploadActor,
      },
      include: documentUploadedByInclude,
    });

    await this.audit.log(
      tenantId,
      "UPLOAD_OTHER_DOC",
      "JOB",
      jobId,
      { documentId: doc.id, type: "OTHER" },
      actorUserId,
    );

    rt.publishDocumentEvent(this.realtime, "document.uploaded", tenantId, doc.id, {
      jobId,
    });

    return this.attachSignedUrl(doc);
  }

  async generateTripDeliveryDoDocument(
    tenantId: string,
    jobId: string,
    tripId: string,
    user: any,
    source: "AUTO_CREATE_JOB" | "MANUAL_REGENERATE" = "MANUAL_REGENERATE",
    cachedJob?: {
      id: string;
      items?: unknown[];
      externalRef?: string | null;
      internalRef?: string | null;
      customerCompany?: { name?: string | null } | null;
      assignedDriver?: unknown;
      [key: string]: unknown;
    } | null,
  ) {
    this.assertCustomerCanOnlyRead(user);
    const userId: string | null = user?.userId ?? null;
    const job =
      cachedJob && cachedJob.id === jobId
        ? cachedJob
        : await this.prisma.job.findFirst({
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

    if (source === "AUTO_CREATE_JOB") {
      const existingAutoDo =
        typeof this.prisma.tripDocument?.findFirst === "function"
          ? await this.prisma.tripDocument.findFirst({
              where: {
                tenantId,
                tripId,
                type: TripDocumentType.DELIVERY_DO,
                isActive: true,
              },
            })
          : null;
      if (existingAutoDo) {
        return this.attachSignedUrl(existingAutoDo);
      }
    }

    if (!isTripDocumentRequirementFrozen(trip.status)) {
      await ensureDefaultTripDocumentRequirementSnapshots(this.prisma, tenantId, [
        tripId,
      ]);
    }

    const previousDo = await this.replaceTripDocumentByType(
      tenantId,
      tripId,
      TripDocumentType.DELIVERY_DO,
    );

    const pdfStarted = Date.now();
    const pdfBuffer = await this.buildDoPdfBuffer(job);
    if (process.env.JOB_MESSAGE_IMPORT_CONFIRM_PERF === "1") {
      console.info("job_message_import_confirm_perf", {
        name: `deliveryDo.pdf:${tripId}`,
        ms: Date.now() - pdfStarted,
      });
    }

    const refForFile =
      job.externalRef?.trim() || job.internalRef?.trim() || job.id;

    const safeRef = this.safeFileName(refForFile);
    const fileName = `${safeRef}_delivery-do.pdf`;
    const storageKey = `${tenantId}/jobs/${jobId}/trips/${tripId}/delivery-do/${Date.now()}-${fileName}`;

    const uploadStarted = Date.now();
    const { error: uploadError } = await this.supabaseService
      .getClient()
      .storage.from(JOB_DOCUMENTS_BUCKET)
      .upload(storageKey, pdfBuffer, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (process.env.JOB_MESSAGE_IMPORT_CONFIRM_PERF === "1") {
      console.info("job_message_import_confirm_perf", {
        name: `deliveryDo.storageUpload:${tripId}`,
        ms: Date.now() - uploadStarted,
      });
    }

    if (uploadError) {
      throw new BadRequestException(
        `Failed to upload DO PDF: ${uploadError.message}`,
      );
    }

    const uploadActor = await loadUploadActorFields(this.prisma, userId, user);
    const doc = await this.prisma.tripDocument.create({
      data: {
        tenantId,
        tripId,
        type: TripDocumentType.DELIVERY_DO,
        storageKey,
        originalName: fileName,
        mimeType: "application/pdf",
        sizeBytes: pdfBuffer.length,
        uploadedByUserId: uploadActor.uploadedByUserId,
        uploadedByNameSnapshot:
          uploadActor.uploadedByNameSnapshot
          ?? (uploadActor.uploadedByUserId ? null : "System"),
        generatedBySystem: true,
        generatedSource: source,
        requiresSignature: await this.resolveTripDocumentRequiresSignature(
          tenantId,
          tripId,
          TripDocumentType.DELIVERY_DO,
          true,
        ),
      },
      include: documentUploadedByInclude,
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
      include: documentUploadedByInclude,
    });

    return docs.map((doc) => this.toDocumentMetadataDto(doc));
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
    quotationSource: "CUSTOMER_QUOTATION" | "CUSTOMER_RATE_TEMPLATE" | "NONE";
    boundQuotation: {
      id: string;
      quotationNo: string;
      title: string | null;
      status: string;
    } | null;
    acceptedQuotations: Array<{
      id: string;
      quotationNo: string;
      title: string | null;
      status: string;
      acceptedAt: string | null;
      validUntil: string | null;
      pickerGroup: string;
      lines: any[];
    }>;
    legacyTemplate: {
      id: string;
      name: string;
      lines: any[];
    } | null;
    quotationLines: any[];
    dhcReferences: any[];
    existingSnapshot: any[];
  }> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      include: {
        sourceCustomerQuotation: {
          select: sourceCustomerQuotationSelect,
        },
        charges: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    });
    if (!job) throw new NotFoundException("Job not found");
    this.assertCanAccessJob(job, user);

    let quotationSource: "CUSTOMER_QUOTATION" | "CUSTOMER_RATE_TEMPLATE" | "NONE" =
      "NONE";
    let quotationLines: any[] = [];
    let acceptedQuotations: Array<{
      id: string;
      quotationNo: string;
      title: string | null;
      status: string;
      acceptedAt: string | null;
      validUntil: string | null;
      pickerGroup: string;
      lines: any[];
    }> = [];
    let legacyTemplate: {
      id: string;
      name: string;
      lines: any[];
    } | null = null;
    const bound = job.sourceCustomerQuotation;
    const boundQuotation = bound
      ? {
          id: bound.id,
          quotationNo: bound.quotationNo,
          title: bound.title ?? null,
          status: bound.status,
        }
      : null;

    const toCatalogueEntry = (
      quotation: {
        id: string;
        quotationNo: string;
        title?: string | null;
        status: string;
        acceptedAt?: Date | null;
        validUntil?: Date | null;
      },
      lines: any[],
    ) => ({
      id: quotation.id,
      quotationNo: quotation.quotationNo,
      title: quotation.title ?? null,
      status: quotation.status,
      acceptedAt: quotation.acceptedAt?.toISOString() ?? null,
      validUntil: quotation.validUntil?.toISOString() ?? null,
      pickerGroup: formatAcceptedQuotationCatalogueLabel(quotation),
      lines,
    });

    if (bound?.status === CustomerQuotationStatus.ACCEPTED) {
      const lines = await this.prisma.customerQuotationLine.findMany({
        where: { tenantId, quotationId: bound.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });
      const mapped = mapCustomerQuotationLinesToChargeOptions(lines, bound);
      quotationLines = mapped;
      acceptedQuotations = [toCatalogueEntry(bound, mapped)];
      quotationSource = "CUSTOMER_QUOTATION";
    } else if (!job.sourceCustomerQuotationId) {
      const acceptedList = await this.prisma.customerQuotation.findMany({
        where: {
          tenantId,
          customerCompanyId: job.customerCompanyId,
          status: CustomerQuotationStatus.ACCEPTED,
        },
        orderBy: [{ acceptedAt: "asc" }, { quotationNo: "asc" }],
      });

      if (acceptedList.length > 0) {
        acceptedQuotations = await Promise.all(
          acceptedList.map(async (quotation) => {
            const lines = await this.prisma.customerQuotationLine.findMany({
              where: { tenantId, quotationId: quotation.id },
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            });
            const mapped = mapCustomerQuotationLinesToChargeOptions(
              lines,
              quotation,
            );
            return toCatalogueEntry(quotation, mapped);
          }),
        );
        quotationLines = acceptedQuotations.flatMap((entry) => entry.lines);
        quotationSource = "CUSTOMER_QUOTATION";
      } else {
        const template = await this.prisma.customerRateTemplate.findFirst({
          where: {
            tenantId,
            customerCompanyId: job.customerCompanyId,
            status: CustomerRateTemplateStatus.ACTIVE,
          },
          orderBy: [{ updatedAt: "desc" }],
          include: {
            rows: {
              where: { isActive: true },
              orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }],
            },
          },
        });
        if (template) {
          legacyTemplate = {
            id: template.id,
            name: template.name,
            lines: mapCustomerRateTemplateRowsToChargeOptions(
              template.rows,
              template,
            ),
          };
          quotationSource = "NONE";
        }
      }
    }

    const dhcDataset =
      (await this.prisma.masterRateDataset.findFirst({
        where: {
          tenantId,
          type: MasterRateDatasetType.DHC_RATES,
          isCurrent: true,
        },
        select: { id: true },
      })) ??
      (await this.prisma.masterRateDataset.findFirst({
        where: {
          tenantId,
          type: MasterRateDatasetType.DHC_RATES,
          status: MasterRateDatasetStatus.ACTIVE,
        },
        orderBy: { versionNo: "desc" },
        select: { id: true },
      }));
    const dhcRows = dhcDataset
      ? await this.prisma.masterRateDatasetRow.findMany({
          where: { tenantId, datasetId: dhcDataset.id, isActive: true },
          orderBy: { code: "asc" },
        })
      : [];
    const dhcReferences = dhcRows.map((row) => ({
      ...row,
      source: "DHC_REFERENCE",
    }));

    const chargeIds = (job.charges ?? []).map((c) => c.id);
    const reservedIds = new Set<string>();
    if (chargeIds.length && this.prisma.invoiceChargeReservation) {
      const reservations = await this.prisma.invoiceChargeReservation.findMany({
        where: { tenantId, jobChargeId: { in: chargeIds } },
        select: { jobChargeId: true },
      });
      for (const row of reservations) reservedIds.add(row.jobChargeId);
    }

    return {
      quotationSource,
      boundQuotation,
      acceptedQuotations,
      legacyTemplate,
      quotationLines,
      dhcReferences,
      existingSnapshot: (job.charges ?? []).map((c) => ({
        ...c,
        reservedOnInvoice: reservedIds.has(c.id),
        provenanceLabel: jobChargeProvenanceLabel({
          sourceType: c.sourceType,
          sourceCustomerQuotationLineId: c.sourceCustomerQuotationLineId,
          metadataJson: c.metadataJson,
        }),
      })),
    };
  }

  async getAvailableChargesForJob(
    tenantId: string,
    jobId: string,
    user: any,
  ) {
    return this.getBillingChargeOptionsForJob(tenantId, jobId, user);
  }

  async listDriverTripRateMasters(tenantId: string) {
    try {
      const dataset =
        (await this.prisma.masterRateDataset.findFirst({
          where: {
            tenantId,
            type: MasterRateDatasetType.TRUCKING_RATES,
            isCurrent: true,
          },
          select: { id: true },
        })) ??
        (await this.prisma.masterRateDataset.findFirst({
          where: {
            tenantId,
            type: MasterRateDatasetType.TRUCKING_RATES,
            status: MasterRateDatasetStatus.ACTIVE,
          },
          orderBy: { versionNo: "desc" },
          select: { id: true },
        }));
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
    // Prefer current TRUCKING_RATES dataset row when available.
    if (this.prisma.masterRateDataset?.findFirst) {
      const dataset =
        (await this.prisma.masterRateDataset.findFirst({
          where: {
            tenantId,
            type: MasterRateDatasetType.TRUCKING_RATES,
            isCurrent: true,
          },
          select: { id: true },
        })) ??
        (await this.prisma.masterRateDataset.findFirst({
          where: {
            tenantId,
            type: MasterRateDatasetType.TRUCKING_RATES,
            status: MasterRateDatasetStatus.ACTIVE,
          },
          orderBy: { versionNo: "desc" },
          select: { id: true },
        }));
      if (dataset && this.prisma.masterRateDatasetRow?.findFirst) {
        const row = await this.prisma.masterRateDatasetRow.findFirst({
          where: {
            id,
            tenantId,
            datasetId: dataset.id,
            isActive: true,
          },
        });
        if (row) return row;
      }
    }

    // Legacy DriverPayoutItem fallback for backward compatibility.
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

    const jobTypesResolved = resolveJobTypesForResponse({
      assignments: await this.prisma.jobTypeAssignment.findMany({
        where: { tenantId, jobId },
        select: { jobType: true },
      }),
      legacyJobType: job.jobType,
    });
    const tripTypeCheck = assertTripTypeBelongsToJob(
      dto.tripType,
      jobTypesResolved.jobTypes,
    );
    if (tripTypeCheck.ok === false) {
      throw new BadRequestException({
        code: tripTypeCheck.code,
        message: tripTypeCheck.message,
      });
    }
    const tripType = tripTypeCheck.tripType;

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

    const tripDisplayLabel = jobTripTemplateDisplayLabel(normalizedTemplate);
    const route = resolveAppendTripRouteSnapshot(normalizedTemplate, dto);

    const trip = await this.prisma.trip.create({
      data: {
        tenantId,
        jobId,
        jobSequence: nextSeq,
        tripSequence: nextSeq,
        jobTripTemplate: normalizedTemplate,
        tripType,
        title: dto.title?.trim() || tripDisplayLabel,
        displayTitle: dto.title?.trim() || tripDisplayLabel,
        notes: normalizeOptionalNotes(dto.notes),
        tripPICName: dto.tripPICName?.trim() || null,
        tripPICContact: dto.tripPICContact?.trim() || null,
        containerNumber: dto.containerNumber?.trim() || null,
        carrier: dto.carrier?.trim() || null,
        shipper: dto.shipper?.trim() || null,
        vessel: dto.vessel?.trim() || null,
        plannedStartAt,
        originLabel: route.originLabel,
        destinationLabel: route.destinationLabel,
        originAddressLine1: route.originAddressLine1,
        originAddressLine2: route.originAddressLine2,
        destinationAddressLine1: route.destinationAddressLine1,
        destinationAddressLine2: route.destinationAddressLine2,
        originPostalCode: route.originPostalCode,
        destinationPostalCode: route.destinationPostalCode,
        originCountry: route.originCountry,
        destinationCountry: route.destinationCountry,
        originPlaceId: route.originPlaceId,
        destinationPlaceId: route.destinationPlaceId,
        originLat: route.originLat,
        originLng: route.originLng,
        destinationLat: route.destinationLat,
        destinationLng: route.destinationLng,
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

    await ensureDefaultTripDocumentRequirementSnapshots(this.prisma, tenantId, [
      trip.id,
    ]);

    // Phase 1 TripJobItem linkage on append.
    const jobItems = await this.prisma.jobItem.findMany({
      where: { tenantId, jobId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, itemCode: true },
    });
    const requestedLinkIds = normalizeJobItemIdsInput(dto.jobItemIds);
    if (isContainerBasedTransportJob(job.jobType as JobType, jobItems.length)) {
      let linkIds = requestedLinkIds;
      if (
        linkIds.length === 0
        && jobItems.length === 1
        && canonicalAutoTripCarriesCreatedJobItems(
          job.jobType as JobType,
          normalizedTemplate,
        )
      ) {
        linkIds = [jobItems[0].id];
      }
      if (linkIds.length > 0) {
        await createTripJobItemLinksIfAbsent(this.prisma as any, {
          tenantId,
          tripId: trip.id,
          jobId,
          tripStatus: TripStatus.DRAFT,
          previousContainerNumber: trip.containerNumber,
          jobItemIds: linkIds,
          linkedByUserId: actorUserId,
        });
      }
    }

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

    await this.syncJobInvoiceReadinessForJob(tenantId, jobId);

    rt.publishTripEvent(this.realtime, "trip.created", tenantId, jobId, trip.id, {
      driverUserId: trip.assignedDriverUserId,
    });

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
      await this.syncJobInvoiceReadinessForJob(tenantId, jobId);
      rt.publishTripEvent(this.realtime, "trip.updated", tenantId, jobId, tripId, {
        driverUserId: trip.assignedDriverUserId,
        reason: "deleted",
      });
      if (trip.assignedDriverUserId) {
        rt.publishDriverActiveJobsUpdated(
          this.realtime,
          tenantId,
          trip.assignedDriverUserId,
        );
      }
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
      await this.syncJobInvoiceReadinessForJob(tenantId, jobId);
    }

    rt.publishTripEvent(this.realtime, "trip.cancelled", tenantId, jobId, tripId, {
      driverUserId: trip.assignedDriverUserId,
      tripStatus: TripStatus.CANCELLED,
      reason: "Deleted by ops",
      ...this.notifyActorContext(user),
    });
    if (trip.assignedDriverUserId) {
      rt.publishDriverActiveJobsUpdated(
        this.realtime,
        tenantId,
        trip.assignedDriverUserId,
      );
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

    this.realtime?.publishDispatchAndDashboard(tenantId, {
      jobId,
      reason: "trip.reordered",
    });

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
      jobId?: string | null;
      jobTripTemplate?: JobTripTemplate | null;
    },
    opts?: {
      jobId?: string | null;
      jobType?: JobType | null;
      jobItemCount?: number;
      linkedJobItemCount?: number;
    },
  ): Promise<{ readiness: TripPublishReadinessResult; payoutLines: any[] }> {
    const payoutLines =
      (this.prisma as any).tripPayoutLine?.findMany
        ? await this.prisma.tripPayoutLine.findMany({
            where: { tenantId, tripId: trip.id },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          })
        : [];

    let jobType = opts?.jobType;
    let jobItemCount = opts?.jobItemCount;
    let linkedJobItemCount = opts?.linkedJobItemCount;
    const jobId = opts?.jobId ?? trip.jobId ?? null;

    if (
      (jobType === undefined || jobItemCount === undefined || linkedJobItemCount === undefined)
      && jobId
      && typeof this.prisma?.job?.findFirst === "function"
    ) {
      const job = await this.prisma.job.findFirst({
        where: { id: jobId, tenantId },
        select: {
          jobType: true,
          _count: { select: { items: true } },
        },
      });
      if (job) {
        jobType = jobType ?? job.jobType;
        jobItemCount = jobItemCount ?? job._count?.items ?? 0;
      }
      if (linkedJobItemCount === undefined && typeof (this.prisma as any).tripJobItem?.count === "function") {
        linkedJobItemCount = await this.prisma.tripJobItem.count({
          where: { tenantId, tripId: trip.id },
        });
      } else if (linkedJobItemCount === undefined) {
        linkedJobItemCount = 0;
      }
    } else if (linkedJobItemCount === undefined) {
      linkedJobItemCount = 0;
    }
    if (jobItemCount === undefined) jobItemCount = 0;

    const readiness = evaluateTripPublishReadiness({
      status: trip.status,
      assignedDriverUserId: trip.assignedDriverUserId ?? null,
      driverId: trip.driverId ?? null,
      vehicleId: trip.vehicleId ?? null,
      fleetVehicleId: trip.fleetVehicleId ?? null,
      driverEarningCents: trip.driverEarningCents ?? null,
      payoutLines,
      jobType: jobType ?? null,
      jobItemCount: jobItemCount ?? 0,
      linkedJobItemCount: linkedJobItemCount ?? 0,
      jobTripTemplate: trip.jobTripTemplate ?? null,
    });
    return { readiness, payoutLines };
  }

  /**
   * Ensures TripJobItem links satisfy publish for container-based trips.
   * Auto-heals single-item jobs.
   */
  private async ensureTripJobItemsReadyForPublish(
    tenantId: string,
    jobId: string,
    tripId: string,
    tripStatus: TripStatus,
    actorUserId: string | null,
  ): Promise<{ ok: boolean; errorMessage: string | null }> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      select: {
        jobType: true,
        items: {
          select: { id: true, itemCode: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!job) return { ok: false, errorMessage: "Job not found" };

    const jobItems = Array.isArray(job.items) ? job.items : [];
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
      select: { containerNumber: true, jobTripTemplate: true },
    });
    const existingLinks =
      (this.prisma as any).tripJobItem?.findMany
        ? await this.prisma.tripJobItem.findMany({
            where: { tenantId, tripId },
            select: { id: true },
          })
        : [];
    const linkReadiness = evaluateTripPublishLinkReadiness({
      jobType: job.jobType,
      jobItemCount: jobItems.length,
      linkedJobItemCount: existingLinks.length,
      jobItemIds: jobItems.map((i) => i.id),
      jobTripTemplate: trip?.jobTripTemplate ?? null,
    });
    if (linkReadiness.shouldAutoHealSingleItem && linkReadiness.singleJobItemId) {
      if (!(this.prisma as any).tripJobItem?.createMany && !(this.prisma as any).tripJobItem?.findMany) {
        // Test/compat mocks without TripJobItem model: skip auto-heal persistence.
        return { ok: true, errorMessage: null };
      }
      await createTripJobItemLinksIfAbsent(this.prisma as any, {
        tenantId,
        tripId,
        jobId,
        tripStatus,
        previousContainerNumber: trip?.containerNumber ?? null,
        jobItemIds: [linkReadiness.singleJobItemId],
        linkedByUserId: actorUserId,
      });
      return { ok: true, errorMessage: null };
    }
    if (linkReadiness.required && !linkReadiness.satisfied) {
      return {
        ok: false,
        errorMessage:
          linkReadiness.errorMessage
          ?? "Container-based trip requires linked cargo before publish.",
      };
    }
    return { ok: true, errorMessage: null };
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
        jobTripTemplate: true,
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
      const { readiness, payoutLines } = await this.getTripPublishState(tenantId, trip, {
        jobId,
      });
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
        continue;
      }

      // Phase 1 link gate (same rules as publishTrip).
      const linkGate = await this.ensureTripJobItemsReadyForPublish(
        tenantId,
        jobId,
        trip.id,
        trip.status,
        actorUserId,
      );
      if (!linkGate.ok) {
        blockedTrips.push({
          tripId: trip.id,
          tripDisplayRef: buildTripDisplayRef({
            jobInternalRef: job.internalRef,
            tripSequence: trip.tripSequence,
            jobSequence: trip.jobSequence,
            tripId: trip.id,
          }),
          reason: linkGate.errorMessage ?? "Linked cargo required before publish",
        });
        continue;
      }

      readyTripIds.push(trip.id);
      payoutLineCountByTrip.set(trip.id, payoutLines.length);
      payoutTotalByTrip.set(trip.id, readiness.totalPayoutCents);
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
          const totalPayoutCents = payoutTotalByTrip.get(tripId) ?? null;
          await tx.trip.update({
            where: { id: tripId },
            data: {
              status: TripStatus.PUBLISHED,
              pendingState: TripPendingState.NONE,
              publishedAt: new Date(),
              publishedByUserId: actorUserId,
              driverEarningCents:
                totalPayoutCents != null && totalPayoutCents > 0
                  ? totalPayoutCents
                  : null,
              ...(payoutLineCount > 0
                ? { earningLabelSnapshot: `${payoutLineCount} payout items` }
                : {}),
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

    await this.syncJobInvoiceReadinessForJob(tenantId, jobId);

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
    if (dto.tripType !== undefined) {
      const lock = assertTripTypeEditableStatus(String(trip.status));
      if (lock.ok === false) {
        throw new ConflictException({
          code: lock.code,
          message: lock.message,
        });
      }
      const parentTypes = resolveJobTypesForResponse({
        assignments: await this.prisma.jobTypeAssignment.findMany({
          where: { tenantId, jobId },
          select: { jobType: true },
        }),
        legacyJobType: (
          await this.prisma.job.findFirst({
            where: { id: jobId, tenantId },
            select: { jobType: true },
          })
        )?.jobType,
      }).jobTypes;
      const check = assertTripTypeBelongsToJob(dto.tripType, parentTypes);
      if (check.ok === false) {
        throw new BadRequestException({
          code: check.code,
          message: check.message,
        });
      }
      data.tripType = check.tripType;
    }
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
      assertTripPayoutMutable(trip.status);
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

    const previousContainerNumber =
      dto.containerNumber !== undefined
        ? (dto.containerNumber?.trim() || null)
        : trip.containerNumber;

    // When jobItemIds is included, keep trip field patch + link replace atomic.
    if (dto.jobItemIds !== undefined) {
      if (typeof (this.prisma as any).$transaction === "function") {
        await this.prisma.$transaction(async (tx) => {
          await tx.trip.update({
            where: { id: tripId },
            data,
          });
          await replaceTripJobItemLinks(tx as any, {
            tenantId,
            tripId,
            jobId,
            tripStatus: trip.status,
            previousContainerNumber,
            jobItemIds: normalizeJobItemIdsInput(dto.jobItemIds),
            linkedByUserId: actorUserId,
          });
        });
      } else {
        await this.prisma.trip.update({
          where: { id: tripId },
          data,
        });
        await replaceTripJobItemLinks(this.prisma as any, {
          tenantId,
          tripId,
          jobId,
          tripStatus: trip.status,
          previousContainerNumber,
          jobItemIds: normalizeJobItemIdsInput(dto.jobItemIds),
          linkedByUserId: actorUserId,
        });
      }
    } else {
      await this.prisma.trip.update({
        where: { id: tripId },
        data,
      });
    }

    const changedFields = Object.keys(data).filter((k) => k !== "updatedByUserId");
    if (dto.jobItemIds !== undefined) changedFields.push("jobItemIds");

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

    rt.publishTripEvent(this.realtime, "trip.updated", tenantId, jobId, tripId, {
      driverUserId: trip.assignedDriverUserId,
      tripStatus: trip.status as TripStatus,
      ...this.notifyActorContext(user),
      ...(dto.earningRateMasterId !== undefined
        ? { notificationKind: "EARNINGS_UPDATED", earningsAmountCents: data.driverEarningCents ?? trip.driverEarningCents }
        : {}),
    });

    return this.getOne(tenantId, jobId, user);
  }

  async patchTripDetails(
    tenantId: string,
    jobId: string,
    tripId: string,
    dto: PatchTripDetailsDto,
    user: any,
  ): Promise<any> {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;

    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
    });
    if (!job) throw new NotFoundException("Job not found");
    this.assertCanAccessJob(job, user);

    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
    });
    if (!trip) throw new NotFoundException("Trip not found");

    assertTripDetailsEditAllowed(
      trip.status as TripStatus,
      job.status,
      dto,
    );

    const raw = dto as Record<string, unknown>;
    const routeChanged = dtoHasAnyDefinedKey(raw, TRIP_DETAILS_ROUTE_JOB_KEYS);
    const jobData: Record<string, unknown> = {};
    const tripData: Record<string, unknown> = {};

    if (dto.pickupAddress1 !== undefined) jobData.pickupAddress1 = dto.pickupAddress1;
    if (dto.pickupAddress2 !== undefined) jobData.pickupAddress2 = dto.pickupAddress2;
    if (dto.pickupPostal !== undefined) jobData.pickupPostal = dto.pickupPostal;
    if (dto.pickupContactName !== undefined) {
      jobData.pickupContactName = dto.pickupContactName?.trim() || null;
    }
    if (dto.pickupContactPhone !== undefined) {
      jobData.pickupContactPhone = dto.pickupContactPhone?.trim() || null;
    }
    if (dto.deliveryAddress1 !== undefined) jobData.deliveryAddress1 = dto.deliveryAddress1;
    if (dto.deliveryAddress2 !== undefined) jobData.deliveryAddress2 = dto.deliveryAddress2;
    if (dto.deliveryPostal !== undefined) jobData.deliveryPostal = dto.deliveryPostal;
    if (dto.receiverName !== undefined) jobData.receiverName = dto.receiverName;
    if (dto.receiverPhone !== undefined) jobData.receiverPhone = dto.receiverPhone;

    const jobNotesValue = resolveTripDetailsJobNotesInput(dto);
    if (jobNotesValue !== undefined) {
      jobData.notes = normalizeOptionalNotes(jobNotesValue);
    }
    if (dto.notes !== undefined) {
      tripData.notes = normalizeOptionalNotes(dto.notes);
    }

    if (dto.collectionType !== undefined && job.jobType === JobType.COLLECTION) {
      jobData.collectionType = dto.collectionType;
    }
    if (dto.vesselName !== undefined) {
      jobData.vesselName = dto.vesselName?.trim() || null;
    }
    if (dto.vesselEta !== undefined) {
      jobData.vesselEta = dto.vesselEta ? new Date(dto.vesselEta) : null;
    }
    if (dto.returningDepotCode !== undefined) {
      jobData.returningDepotCode = dto.returningDepotCode?.trim() || null;
    }
    if (dto.returnLastDay !== undefined) {
      jobData.returnLastDay = dto.returnLastDay ? new Date(dto.returnLastDay) : null;
    }
    if (dto.pickupPortCode !== undefined) {
      jobData.pickupPortCode = dto.pickupPortCode?.trim() || null;
    }

    if (dto.plannedStartAt !== undefined) {
      tripData.plannedStartAt = dto.plannedStartAt
        ? new Date(dto.plannedStartAt)
        : null;
    }
    if (dto.tripPICName !== undefined) {
      tripData.tripPICName = dto.tripPICName?.trim() || null;
    }
    if (dto.tripPICContact !== undefined) {
      tripData.tripPICContact = dto.tripPICContact?.trim() || null;
    }
    tripData.updatedByUserId = actorUserId;

    const inputItems = readUpdateJobItemsInput(dto as {
      items?: unknown;
      cargoItems?: unknown;
    });

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(jobData).length > 0) {
        await tx.job.update({ where: { id: jobId }, data: jobData });
      }
      if (Object.keys(tripData).length > 0) {
        await tx.trip.update({ where: { id: tripId }, data: tripData });
      }
      if (inputItems !== null) {
        const validItems = parseValidUpdateJobItemsFromInput(
          inputItems,
          job.jobType,
        );
        assertCreateJobItemsRequiredForJobType(
          job.jobType,
          inputItems,
          validItems,
        );
        await applyJobItemsUpdateInTransaction(tx as any, {
          tenantId,
          jobId,
          validItems,
          // Operational single-row edits default to patch (preserve siblings).
          // Full LCL/cargo replace must send replaceItems: true.
          replaceItems: (dto as { replaceItems?: boolean }).replaceItems === true,
        });
      }
    });

    if (routeChanged && isPlanningEligibleStatus(trip.status as TripStatus)) {
      await this.syncTripRouteSnapshotForJob(tenantId, jobId, {
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        pickupPlaceId: dto.pickupPlaceId,
        deliveryLat: dto.deliveryLat,
        deliveryLng: dto.deliveryLng,
        deliveryPlaceId: dto.deliveryPlaceId,
        tripStatuses: [TripStatus.DRAFT, TripStatus.PUBLISHED],
      });
    }

    const changedFields = [
      ...Object.keys(jobData).map((k) => (k === "notes" ? "jobNotes" : k)),
      ...Object.keys(tripData).filter((k) => k !== "updatedByUserId"),
      ...(inputItems !== null ? ["items"] : []),
    ];

    await this.audit.log(
      tenantId,
      "TRIP_DETAILS_UPDATE",
      "JOB",
      jobId,
      { tripId, changedFields },
      actorUserId,
    );

    const notificationKind = resolveTripDetailsNotificationKind(changedFields);
    if (notificationKind) {
      rt.publishTripEvent(this.realtime, "trip.updated", tenantId, jobId, tripId, {
        driverUserId: trip.assignedDriverUserId,
        tripStatus: trip.status as TripStatus,
        notificationKind,
        ...this.notifyActorContext(user),
      });
    }
    rt.publishJobEvent(this.realtime, "job.updated", tenantId, jobId);

    return this.getTripDetail(tenantId, tripId, user);
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
    rt.publishTripEvent(this.realtime, "trip.assigned", tenantId, jobId, tripId, {
      driverUserId: dto.driverId,
      tripStatus: trip.status as TripStatus,
      ...this.notifyActorContext(user),
    });
    if (oldDriverUserId && oldDriverUserId !== dto.driverId) {
      rt.publishTripEvent(this.realtime, "trip.unassigned", tenantId, jobId, tripId, {
        driverUserId: oldDriverUserId,
        tripStatus: trip.status as TripStatus,
        ...this.notifyActorContext(user),
      });
    }
    rt.publishDriverActiveJobsUpdated(this.realtime, tenantId, dto.driverId);
    if (oldDriverUserId && oldDriverUserId !== dto.driverId) {
      rt.publishDriverActiveJobsUpdated(this.realtime, tenantId, oldDriverUserId);
    }
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
        containerNumber: true,
        jobId: true,
        jobTripTemplate: true,
      },
    });
    if (!trip) throw new NotFoundException("Trip not found");

    const { readiness, payoutLines } = await this.getTripPublishState(tenantId, trip, {
      jobId,
    });
    if (!readiness.canPublish) {
      throw new BadRequestException(readiness.errorMessage ?? "Trip is not ready to publish");
    }

    // Phase 1: container-based trips require ≥1 TripJobItem. Single-item may auto-heal.
    const linkGate = await this.ensureTripJobItemsReadyForPublish(
      tenantId,
      jobId,
      tripId,
      trip.status,
      actorUserId,
    );
    if (!linkGate.ok) {
      throw new BadRequestException(
        linkGate.errorMessage ?? "Container-based trip requires linked cargo before publish.",
      );
    }

    const publishDocRows = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
      select: {
        status: true,
        documents: {
          where: { isActive: true },
          select: {
            type: true,
            isActive: true,
            isSigned: true,
            signedAt: true,
            mimeType: true,
            originalName: true,
          },
        },
        documentRequirements: {
          select: {
            id: true,
            type: true,
            label: true,
            isRequired: true,
            requiresSignature: true,
            minCount: true,
            sortOrder: true,
            responsibleUploader: true,
            requirementStage: true,
          },
        },
      },
    });
    const publishDocEvaluation = evaluateTripDocumentRequirements({
      tripStatus: publishDocRows?.status ?? trip.status,
      documents: publishDocRows?.documents ?? [],
      requirements: publishDocRows?.documentRequirements ?? [],
      forStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
    });
    if (publishDocEvaluation.missingTypeCodes.length > 0) {
      const labels =
        publishDocEvaluation.summaryLabels.length > 0
          ? publishDocEvaluation.summaryLabels.join("; ")
          : publishDocEvaluation.missingTypeCodes.join(", ");
      throw new BadRequestException(
        `Trip cannot be published yet. Missing required documents before dispatch: ${labels}`,
      );
    }

    await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        status: TripStatus.PUBLISHED,
        pendingState: TripPendingState.NONE,
        publishedAt: new Date(),
        publishedByUserId: actorUserId,
        driverEarningCents:
          readiness.totalPayoutCents > 0 ? readiness.totalPayoutCents : null,
        ...(payoutLines.length > 0
          ? { earningLabelSnapshot: `${readiness.payoutLineCount} payout items` }
          : {}),
      },
    });

    await this.audit.log(
      tenantId,
      "TRIP_PUBLISH",
      "TRIP",
      tripId,
      {
        jobId,
        payoutFrozen: true,
        totalPayoutCents: readiness.totalPayoutCents,
        payoutLineCount: readiness.payoutLineCount,
      },
      actorUserId,
    );

    await this.syncJobInvoiceReadinessForJob(tenantId, jobId);
    rt.publishTripEvent(this.realtime, "trip.published", tenantId, jobId, tripId, {
      driverUserId: trip.assignedDriverUserId,
      tripStatus: TripStatus.PUBLISHED,
      ...this.notifyActorContext(user),
    });
    if (trip.assignedDriverUserId) {
      rt.publishDriverActiveJobsUpdated(
        this.realtime,
        tenantId,
        trip.assignedDriverUserId,
      );
    }
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
        assignedDriverUserId: true,
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

    await this.syncJobInvoiceReadinessForJob(tenantId, jobId);

    rt.publishTripEvent(this.realtime, "trip.unpublished", tenantId, jobId, tripId, {
      driverUserId: trip.assignedDriverUserId,
      tripStatus: TripStatus.DRAFT,
      ...this.notifyActorContext(user),
    });
    if (trip.assignedDriverUserId) {
      rt.publishDriverActiveJobsUpdated(
        this.realtime,
        tenantId,
        trip.assignedDriverUserId,
      );
    }

    return {
      ok: true,
      tripId,
      tripDisplayRef,
      status: TripStatus.DRAFT,
    };
  }

  private async syncJobInvoiceReadinessForJob(
    tenantId: string,
    jobId: string,
  ): Promise<void> {
    await syncJobInvoiceReadiness(
      this.prisma as unknown as JobInvoiceSyncPrisma,
      tenantId,
      jobId,
    );
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
    await this.syncJobInvoiceReadinessForJob(tenantId, jobId);
    await this.audit.log(
      tenantId,
      "TRIP_MARK_DONE",
      "TRIP",
      tripId,
      { jobId },
      actorUserId,
    );
    const tripForEmit = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId },
      select: { assignedDriverUserId: true, driverEarningCents: true },
    });
    rt.publishTripEvent(this.realtime, "trip.done", tenantId, jobId, tripId, {
      driverUserId: tripForEmit?.assignedDriverUserId,
      tripStatus: TripStatus.DONE,
      notificationKind: "TRIP_COMPLETED",
      earningsAmountCents: tripForEmit?.driverEarningCents ?? undefined,
      ...this.notifyActorContext(user),
    });
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
      select: { id: true, status: true, assignedDriverUserId: true },
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
  ): Promise<{
    job: JobDto;
    readyForInvoice: boolean;
    alreadyReady: boolean;
    message: string;
    invoiceReadyAt: Date | null;
    existingInvoiceId: string | null;
    redirectTo: string;
  }> {
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

    const tripCount = await this.prisma.trip.count({ where: { tenantId, jobId } });
    if (tripCount === 0) {
      throw new BadRequestException(
        "Job must have at least one trip before sending to invoice",
      );
    }

    const wasAlreadyReady =
      job.status === JobStatus.READY_FOR_INVOICE && !!job.invoiceReadyAt;

    const syncResult = await syncJobInvoiceReadiness(
      this.prisma as unknown as JobInvoiceSyncPrisma,
      tenantId,
      jobId,
    );
    if (!syncResult?.readyForInvoice) {
      throw new BadRequestException(
        syncResult?.reason ?? "Job is not ready for invoice.",
      );
    }

    if (!wasAlreadyReady) {
      await this.audit.log(
        tenantId,
        "JOB_SEND_TO_INVOICE",
        "JOB",
        jobId,
        {
          tripCount,
          sentAt: (syncResult.invoiceReadyAt ?? new Date()).toISOString(),
        },
        actorUserId,
      );
    }

    const existingInvoice = await this.prisma.invoice.findFirst({
      where: { tenantId, sourceJobId: jobId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const jobDto = await this.getOne(tenantId, jobId, user);

    return {
      job: jobDto,
      readyForInvoice: true,
      alreadyReady: wasAlreadyReady,
      message: "Job is ready for invoice",
      invoiceReadyAt: syncResult.invoiceReadyAt,
      existingInvoiceId: existingInvoice?.id ?? null,
      redirectTo: `/invoices/create?jobId=${jobId}`,
    };
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
        jobType: true,
        internalRef: true,
        jobTypeAssignments: { select: { jobType: true } },
        customerCompanyId: true,
        receiverName: true,
        receiverPhone: true,
        notes: true,
        pickupContactName: true,
        pickupContactPhone: true,
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
        _count: { select: { items: true } },
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
        documents: {
          where: {
            isActive: true,
            type: { in: ADMIN_VISIBLE_TRIP_DOCUMENT_TYPES },
          },
          orderBy: { createdAt: "desc" },
          include: documentUploadedByInclude,
        },
        payoutLines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        documentRequirements: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        _count: { select: { tripJobItems: true } },
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
        quantity: line.quantity ?? 1,
        amountCents: line.amountCents ?? null,
        totalCents: line.totalCents ?? null,
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
        jobType: job.jobType ?? null,
        jobItemCount: job._count?.items ?? 0,
        linkedJobItemCount: t._count?.tripJobItems ?? 0,
        jobTripTemplate: t.jobTripTemplate ?? null,
      });
      const driverEarningCentsTotal = resolveCanonicalTripPayoutCents({
        driverEarningCents: t.driverEarningCents ?? null,
        payoutLines: t.payoutLines ?? [],
      });
      const tripDocs = (t.documents ?? []).map((d) => this.toDocumentMetadataDto(d));
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
      driverRemarks: t.driverRemarks ?? null,
      jobSequence: t.jobSequence ?? null,
      tripSequence: t.tripSequence ?? t.jobSequence ?? null,
      jobTripTemplate: t.jobTripTemplate ?? null,
      title: t.title ?? null,
      displayTitle: t.displayTitle ?? t.title ?? null,
      status: t.status,
      ...(() => {
        const parentTypes = resolveJobTypesForResponse({
          assignments: job.jobTypeAssignments,
          legacyJobType: job.jobType,
        }).jobTypes;
        const resolved = resolveTripTypeForResponse({
          tripType: t.tripType,
          parentJobTypes: parentTypes,
          legacyParentJobType: job.jobType,
        });
        return {
          tripType: resolved.tripType,
          tripTypeSource: resolved.tripTypeSource,
        };
      })(),
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
      driverEarningCents: driverEarningCentsTotal,
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
      documents: tripDocs,
      documentRequirements: t.documentRequirements ?? [],
      documentReadiness: toDocumentReadinessDto(
        evaluateTripDocsFromRows({
          status: t.status,
          documents: t.documents,
          documentRequirements: t.documentRequirements,
        }),
      ),
      documentStatus: deriveTripDocumentStatus(t.documents ?? []),
      completionRuleJson:
        (t.completionRuleJson as Record<string, unknown> | null) ?? null,
      ...resolveTripNotesResponseFields(t, job),
      ...resolveTripRouteAddressResponseFields(t),
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
        type: { in: ADMIN_VISIBLE_TRIP_DOCUMENT_TYPES },
      },
      orderBy: { createdAt: "desc" },
      include: documentUploadedByInclude,
    });
    return docs.map((d) => this.toDocumentMetadataDto(d));
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
      TripDocumentType.PERMIT,
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
    const uploadActor = await loadUploadActorFields(this.prisma, actorUserId, user);
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
        ...uploadActor,
        requiresSignature:
          type === TripDocumentType.POD_SIGNATURE
            ? false
            : await this.resolveTripDocumentRequiresSignature(
                tenantId,
                tripId,
                type,
                !!requiresSignature,
              ),
      },
      include: documentUploadedByInclude,
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
    rt.publishDocumentEvent(this.realtime, "document.uploaded", tenantId, doc.id, {
      jobId,
      tripId,
      driverUserId: trip.assignedDriverUserId,
      tripStatus: trip.status as TripStatus,
      notificationKind: "DOCUMENT_ADDED",
      documentTypeLabel: tripDocumentTypeLabel(type),
      ...this.notifyActorContext(user),
    });

    if (type === TripDocumentType.POD_SIGNATURE) {
      await this.refreshSignedDoPdf(tenantId, jobId, tripId, TripDocumentType.DELIVERY_DO, {
        signatureImageBytes: file.buffer,
        signedAt: new Date(),
      });
    }

    return this.attachSignedUrl(doc);
  }

  private isSignatureArtifactDocumentType(type: TripDocumentType): boolean {
    return (
      type === TripDocumentType.POD_SIGNATURE
      || type === TripDocumentType.PICKUP_SIGNATURE
      || type === TripDocumentType.DELIVERY_SIGNATURE
    );
  }

  /**
   * Uploads and records the handwritten signature image for a signed Pickup/Delivery DO.
   */
  async persistSignedDoSignatureImage(
    tenantId: string,
    jobId: string,
    tripId: string,
    doType: SignableDoType,
    params: {
      signatureImageBytes: Buffer;
      mimeType: string;
      signedByName?: string | null;
      signedAt?: Date | null;
      signedByUserId?: string | null;
      signBody?: SignTripDocumentBody | null;
      replaceExisting?: boolean;
    },
  ): Promise<{ id: string; storageKey: string }> {
    const {
      signatureImageBytes,
      mimeType,
      signedByName,
      signedAt,
      signedByUserId,
      signBody,
      replaceExisting = true,
    } = params;

    logDoSignatureDebug({
      phase: "persist_signature_image",
      doType,
      hasSignatureBase64: !!signBody?.signatureBase64?.trim(),
      signatureBase64Length: signBody?.signatureBase64?.trim().length ?? 0,
      hasSignatureImage: !!signBody?.signatureImage?.trim(),
      signatureImagePrefix: signBody?.signatureImage?.trim().slice(0, 32) ?? null,
      signatureContentType: mimeType,
      decodedSignatureBufferBytes: signatureImageBytes.length,
    });

    if (replaceExisting) {
      await this.replaceTripDocumentByType(
        tenantId,
        tripId,
        signatureArtifactTypeForDo(doType),
      );
    }

    const storageKey = buildSignedDoSignatureStorageKey(
      tenantId,
      jobId,
      tripId,
      doType,
      mimeType,
    );
    await this.putJobDocumentObject(storageKey, signatureImageBytes, mimeType);

    const ext =
      mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
    const signatureDoc = await this.prisma.tripDocument.create({
      data: {
        tenantId,
        tripId,
        type: signatureArtifactTypeForDo(doType),
        storageKey,
        originalName: `${doType.toLowerCase()}-signature.${ext}`,
        mimeType,
        sizeBytes: signatureImageBytes.length,
        isActive: true,
        isSigned: true,
        signedAt: signedAt ?? new Date(),
        signedByUserId: signedByUserId ?? null,
        signedByName: signedByName?.trim() || null,
        uploadedByUserId: signedByUserId ?? null,
        requiresSignature: false,
      },
    });

    logDoSignatureDebug({
      phase: "persist_signature_image_complete",
      doType,
      storedSignatureStorageKey: storageKey,
      signatureDocumentId: signatureDoc.id,
    });

    return { id: signatureDoc.id, storageKey };
  }

  async deactivatePreviousSignedDoSignatureArtifacts(
    tenantId: string,
    tripId: string,
    doType: SignableDoType,
    keepDocumentId: string,
  ): Promise<void> {
    await this.prisma.tripDocument.updateMany({
      where: {
        tenantId,
        tripId,
        type: signatureArtifactTypeForDo(doType),
        isActive: true,
        id: { not: keepDocumentId },
      },
      data: { isActive: false },
    });
  }

  /**
   * Rebuilds the active Pickup/Delivery DO PDF with signature/name when available.
   * Updates the same TripDocument row (new storage object) so admin download stays on one doc.
   */
  async refreshSignedDoPdf(
    tenantId: string,
    jobId: string,
    tripId: string,
    doType: SignableDoType,
    overrides?: {
      signatureImageBytes?: Buffer | null;
      recipientName?: string | null;
      signedAt?: Date | null;
    },
  ): Promise<void> {
    const [job, doDoc, signatureArtifacts] = await Promise.all([
      this.prisma.job.findFirst({
        where: { id: jobId, tenantId },
        include: {
          customerCompany: true,
          items: { orderBy: { createdAt: "asc" } },
        },
      }),
      this.prisma.tripDocument.findFirst({
        where: {
          tenantId,
          tripId,
          type: doType,
          isActive: true,
        },
      }),
      this.prisma.tripDocument.findMany({
        where: {
          tenantId,
          tripId,
          type: { in: signatureArtifactFallbackTypes(doType) },
          isActive: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const signatureArtifact = pickPreferredSignatureArtifact(
      signatureArtifacts,
      doType,
    );

    if (!job?.items?.length || !doDoc?.storageKey) {
      return;
    }

    const embedBase = resolveDoSignatureEmbedInput(
      doType,
      doDoc,
      signatureArtifact,
      job,
      overrides,
    );
    if (!embedBase) {
      return;
    }

    let signatureImageBytes = embedBase.signatureImageBytes;
    let downloadedSignatureBytes: Buffer | null = null;
    if (!signatureImageBytes?.length && signatureArtifact?.storageKey) {
      downloadedSignatureBytes = await this.downloadJobDocumentBytes(
        signatureArtifact.storageKey,
      );
      signatureImageBytes = downloadedSignatureBytes;
    }

    const usedSignatureSource = resolveUsedSignatureSource(
      overrides?.signatureImageBytes,
      signatureArtifact,
      downloadedSignatureBytes,
    );
    logDoSignatureDebug({
      phase: "refresh_signed_do_pdf",
      doType,
      usedSignatureSource,
      decodedSignatureBufferBytes: signatureImageBytes?.length ?? 0,
      storedSignatureStorageKey: signatureArtifact?.storageKey ?? null,
    });
    if (!signatureImageBytes?.length) {
      warnMissingSignatureImageForSignedDo(doType, doDoc);
    }

    const variant =
      doType === TripDocumentType.PICKUP_DO ? "pickup" : "delivery";
    const pdfBuffer = await this.buildDoPdfBuffer(job, {
      variant,
      signatureImageBytes,
      recipientName: embedBase.recipientName,
      recipientNric: embedBase.recipientNric,
      signedAt: embedBase.signedAt,
    });

    const refForFile =
      job.externalRef?.trim() || job.internalRef?.trim() || job.id;
    const safeRef = this.safeFileName(refForFile);
    const suffix = doFileSuffixForType(doType);
    const fileName = `${safeRef}_${suffix}.pdf`;
    const folder = doStorageFolderForType(doType);
    const storageKey = `${tenantId}/jobs/${jobId}/trips/${tripId}/${folder}/${Date.now()}-${fileName}`;
    const previousStorageKey = doDoc.storageKey;

    await this.putJobDocumentObject(storageKey, pdfBuffer, "application/pdf");

    const shouldMarkSigned = signableDoHasCustomerSignature(
      doType,
      doDoc,
      signatureArtifact,
      overrides,
    );

    await this.prisma.tripDocument.update({
      where: { id: doDoc.id },
      data: {
        storageKey,
        sizeBytes: pdfBuffer.length,
        originalName: fileName,
        mimeType: "application/pdf",
        ...(shouldMarkSigned && !doDoc.isSigned
          ? {
              isSigned: true,
              signedAt: doDoc.signedAt ?? embedBase.signedAt ?? new Date(),
              signedByName:
                doDoc.signedByName ?? embedBase.recipientName ?? null,
            }
          : {}),
      },
    });

    await this.deleteStorageObjectIfExists(previousStorageKey);
  }

  /** @deprecated Use refreshSignedDoPdf with DELIVERY_DO */
  async refreshSignedDeliveryDoPdf(
    tenantId: string,
    jobId: string,
    tripId: string,
    overrides?: {
      signatureImageBytes?: Buffer | null;
      recipientName?: string | null;
      signedAt?: Date | null;
    },
  ): Promise<void> {
    return this.refreshSignedDoPdf(
      tenantId,
      jobId,
      tripId,
      TripDocumentType.DELIVERY_DO,
      overrides,
    );
  }

  async signTripDocument(
    tenantId: string,
    jobId: string,
    tripId: string,
    documentId: string,
    body: SignTripDocumentBody | undefined,
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
    if (this.isSignatureArtifactDocumentType(doc.type)) {
      throw new BadRequestException(
        "Signature image documents cannot be signed separately; sign the Pickup/Delivery DO instead",
      );
    }
    const signatureImageBytes = parseSignatureImageBytes(body);
    const signatureContentType = parseSignatureContentType(body);
    const signedAt = parseSignedAtFromBody(body) ?? new Date();
    const signedByName = body?.signedByName?.trim() || null;

    if (isSignableDoType(doc.type) && signatureImageBytes?.length) {
      await this.persistSignedDoSignatureImage(
        tenantId,
        jobId,
        tripId,
        doc.type,
        {
          signatureImageBytes,
          mimeType: signatureContentType,
          signedByName,
          signedAt,
          signedByUserId: actorUserId,
          signBody: body,
        },
      );
    }

    const updated = await this.prisma.tripDocument.update({
      where: { id: documentId },
      data: {
        isSigned: true,
        signedAt,
        signedByUserId: actorUserId ?? null,
        signedByName,
      },
      include: documentUploadedByInclude,
    });
    await this.audit.log(
      tenantId,
      "TRIP_DOC_SIGN",
      "TRIP",
      tripId,
      { jobId, documentId },
      actorUserId,
    );
    rt.publishDocumentEvent(this.realtime, "document.signed", tenantId, documentId, {
      jobId,
      tripId,
      driverUserId: trip.assignedDriverUserId,
      tripStatus: trip.status as TripStatus,
      ...this.notifyActorContext(user),
    });

    if (isSignableDoType(updated.type)) {
      await this.refreshSignedDoPdf(tenantId, jobId, tripId, updated.type, {
        signatureImageBytes,
        recipientName: updated.signedByName,
        signedAt: updated.signedAt,
      });
      const refreshed = await this.prisma.tripDocument.findFirst({
        where: { id: documentId, tenantId, tripId, isActive: true },
        include: documentUploadedByInclude,
      });
      if (refreshed) {
        return this.attachSignedUrl(refreshed);
      }
    }

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
            collectionType: true,
            jobTypeAssignments: { select: { jobType: true } },
            status: true,
            notes: true,
            pickupReference: true,
            description: true,
            pickupDate: true,
            receiverName: true,
            receiverPhone: true,
            pickupAddress1: true,
            pickupAddress2: true,
            pickupPostal: true,
            pickupContactName: true,
            pickupContactPhone: true,
            deliveryAddress1: true,
            deliveryAddress2: true,
            deliveryPostal: true,
            vesselName: true,
            vesselEta: true,
            carrierName: true,
            voyage: true,
            shipper: true,
            returningDepotCode: true,
            createdAt: true,
            createdByUserId: true,
            createdBy: { select: { id: true, name: true, email: true } },
            items: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                itemCode: true,
                description: true,
                qty: true,
                sealNo: true,
                pickupReference: true,
              },
            },
            customerCompany: { select: { name: true } },
          },
        },
        vehicles: { select: { id: true, plateNo: true, type: true } },
        fleetVehicle: { select: { id: true, plateNo: true, type: true } },
        documents: {
          where: {
            isActive: true,
            type: { in: ADMIN_VISIBLE_TRIP_DOCUMENT_TYPES },
          },
          orderBy: { createdAt: "desc" },
          include: documentUploadedByInclude,
        },
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
    const docs = (trip.documents ?? []).map((d) => this.toDocumentMetadataDto(d));
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
      sourceRateMasterItemId: line.earningRateMasterId ?? line.payoutItemId ?? null,
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
      isSelectableForTripEarning: line.isSelectableForTripEarning !== false,
    }));
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
    const publishReadiness = evaluateTripPublishReadiness({
      status: trip.status,
      assignedDriverUserId: trip.assignedDriverUserId ?? null,
      driverId: trip.driverId ?? null,
      vehicleId: trip.vehicleId ?? null,
      fleetVehicleId: trip.fleetVehicleId ?? null,
      driverEarningCents: trip.driverEarningCents ?? null,
      payoutLines: trip.payoutLines ?? [],
      jobType: trip.job?.jobType ?? null,
      jobItemCount: cargoItems.length,
      linkedJobItemCount: tripJobItemLinks.length,
      jobTripTemplate: trip.jobTripTemplate ?? null,
    });
    const cargoBuilt = buildTripCargoFromLinks({
      jobType: trip.job?.jobType,
      links: tripJobItemLinks,
      allJobItems: cargoItems,
    });
    const cargo =
      cargoBuilt.mode === "CONTAINER"
        ? { mode: "CONTAINER" as const, containers: cargoBuilt.containers ?? [] }
        : { mode: "ITEMS" as const, items: cargoBuilt.items ?? [] };
    // Canonical linked-cargo collection also drives required document state.
    const linkedItemsForDocs =
      cargoBuilt.cargoSource === "TRIP_JOB_ITEM"
        ? tripJobItemLinks.map((l) => l.jobItem)
        : [];
    const containerDocumentationRequirements =
      isContainerMode && linkedItemsForDocs.length > 0
        ? buildContainerDocumentationRequirements(
            linkedItemsForDocs,
            (trip.documents ?? []).map((d: any) => ({
              type: d.type,
              jobItemId: d.jobItemId ?? null,
              isActive: d.isActive ?? true,
            })),
          )
        : [];
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
      driverRemarks: trip.driverRemarks ?? null,
      ...(() => {
        const parentTypes = resolveJobTypesForResponse({
          assignments: trip.job?.jobTypeAssignments,
          legacyJobType: trip.job?.jobType,
        }).jobTypes;
        const resolved = resolveTripTypeForResponse({
          tripType: trip.tripType,
          parentJobTypes: parentTypes,
          legacyParentJobType: trip.job?.jobType,
        });
        return {
          tripType: resolved.tripType,
          tripTypeSource: resolved.tripTypeSource,
        };
      })(),
      ...resolveTripNotesResponseFields(trip, trip.job),
      ...resolveTripRouteAddressResponseFields(trip),
      startedAt: trip.startedAt ?? null,
      completedAt: trip.closedAt ?? null,
      closedAt: trip.closedAt ?? null,
      job: trip.job
        ? {
            id: trip.job.id,
            internalRef: trip.job.internalRef,
            externalRef: trip.job.externalRef ?? null,
            jobType: trip.job.jobType,
            ...(() => {
              const resolved = resolveJobTypesForResponse({
                assignments: trip.job.jobTypeAssignments,
                legacyJobType: trip.job.jobType,
              });
              return {
                jobTypes: resolved.jobTypes,
                jobTypeSource: resolved.jobTypeSource,
              };
            })(),
            collectionType: trip.job.collectionType ?? null,
            status: trip.job.status,
            customerCompanyId: trip.job.customerCompanyId,
            customerCompanyName: trip.job.customerCompany?.name ?? null,
            notes: trip.job.notes ?? null,
            pickupReference: jobPickupReference,
            description: jobDescription,
            pickupDate: trip.job.pickupDate ?? null,
            contactName: trip.job.receiverName ?? null,
            contactPhone: trip.job.receiverPhone ?? null,
            pickupAddress1: trip.job.pickupAddress1 ?? null,
            pickupAddress2: trip.job.pickupAddress2 ?? null,
            pickupPostal: trip.job.pickupPostal ?? null,
            pickupContactName: trip.job.pickupContactName ?? null,
            pickupContactPhone: trip.job.pickupContactPhone ?? null,
            pickupPlaceId: trip.originPlaceId ?? null,
            pickupLat: trip.originLat ?? null,
            pickupLng: trip.originLng ?? null,
            deliveryAddress1: trip.job.deliveryAddress1 ?? null,
            deliveryAddress2: trip.job.deliveryAddress2 ?? null,
            deliveryPostal: trip.job.deliveryPostal ?? null,
            deliveryPlaceId: trip.destinationPlaceId ?? null,
            deliveryLat: trip.destinationLat ?? null,
            deliveryLng: trip.destinationLng ?? null,
            vesselName: trip.job.vesselName ?? null,
            vesselEta: trip.job.vesselEta ?? null,
            carrierName: trip.job.carrierName ?? null,
            voyage: trip.job.voyage ?? null,
            shipper: trip.job.shipper ?? null,
            returningDepotCode: trip.job.returningDepotCode ?? null,
            createdAt: trip.job.createdAt,
            createdByName:
              trip.job.createdBy?.name?.trim() || trip.job.createdBy?.email || null,
          }
        : null,
      cargo,
      /** Canonical linked-cargo document requirements (same item set as cargo.containers). */
      containerDocumentationRequirements,
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
        driverEarningCents: resolveCanonicalTripPayoutCents({
          driverEarningCents: trip.driverEarningCents ?? null,
          payoutLines: trip.payoutLines ?? [],
        }),
        lines: payoutLines,
      },
      payoutLines,
      documents: docs,
      documentStatus,
      documentRequirements: trip.documentRequirements ?? [],
      documentReadiness: toDocumentReadinessDto(
        evaluateTripDocsFromRows({
          status: trip.status,
          documents: trip.documents,
          documentRequirements: trip.documentRequirements,
        }),
      ),
      trackingSummary: {
        driverLat: driverLoc?.lat ?? null,
        driverLng: driverLoc?.lng ?? null,
        lastSeenAt: driverLoc?.capturedAt ?? null,
        isTrackable: !!trip.assignedDriverUserId,
      },
      completionRuleJson: trip.completionRuleJson ?? null,
      driverEarningCents: resolveCanonicalTripPayoutCents({
        driverEarningCents: trip.driverEarningCents ?? null,
        payoutLines: trip.payoutLines ?? [],
      }),
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

  async patchTripDocumentRequirement(
    tenantId: string,
    jobId: string,
    tripId: string,
    requirementId: string,
    dto: PatchTripDocumentRequirementDto,
    user: any,
  ) {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const job = await this.prisma.job.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException("Job not found");
    this.assertCanAccessJob(job, user);
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
      select: { id: true, status: true },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    if (isTripDocumentRequirementFrozen(trip.status)) {
      throw new BadRequestException(
        "Document requirements are frozen after the trip is published.",
      );
    }
    const requirement = await this.prisma.tripDocumentRequirement.findFirst({
      where: { id: requirementId, tenantId, tripId },
    });
    if (!requirement) throw new NotFoundException("Document requirement not found");

    this.assertEditorResponsibleUploader(dto.responsibleUploader);

    const nextType = dto.type ?? requirement.type;
    const typeChanging = nextType !== requirement.type;
    if (typeChanging) {
      const matchingDocuments = await this.prisma.tripDocument.count({
        where: {
          tenantId,
          tripId,
          type: requirement.type,
          isActive: true,
        },
      });
      if (matchingDocuments > 0) {
        throw new ConflictException({
          code: "REQUIREMENT_TYPE_HAS_DOCUMENTS",
          message:
            "Cannot change requirement type while active documents of the current type exist on this trip.",
          matchingDocumentCount: matchingDocuments,
        });
      }
    }

    const nextRequiresSignature =
      dto.requiresSignature === undefined
        ? requirement.requiresSignature
        : dto.requiresSignature === true;
    if (
      nextRequiresSignature
      && !documentTypeSupportsCustomerSignature(nextType)
    ) {
      throw new BadRequestException(
        `Customer signature is not supported for ${nextType}.`,
      );
    }

    const nextStage = dto.requirementStage ?? requirement.requirementStage;
    if (typeChanging || nextStage !== requirement.requirementStage) {
      const duplicate = await this.prisma.tripDocumentRequirement.findFirst({
        where: {
          tenantId,
          tripId,
          type: nextType,
          requirementStage: nextStage,
          NOT: { id: requirement.id },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException({
          code: "REQUIREMENT_TYPE_STAGE_DUPLICATE",
          message: `A document requirement already exists for ${nextType} at stage ${nextStage} on this trip (${tripDocumentRequirementDuplicateKey({ tenantId, tripId, type: nextType, requirementStage: nextStage })}).`,
        });
      }
    }

    const before = {
      type: requirement.type,
      label: requirement.label,
      isRequired: requirement.isRequired,
      requiresSignature: requirement.requiresSignature,
      minCount: requirement.minCount,
      sortOrder: requirement.sortOrder,
      responsibleUploader: requirement.responsibleUploader,
      requirementStage: requirement.requirementStage,
    };

    let updated;
    try {
      updated = await this.prisma.tripDocumentRequirement.update({
        where: { id: requirement.id },
        data: {
          ...(dto.type === undefined ? {} : { type: nextType }),
          ...(dto.isRequired === undefined ? {} : { isRequired: dto.isRequired === true }),
          ...(dto.requiresSignature === undefined
            ? {}
            : { requiresSignature: nextRequiresSignature }),
          ...(dto.label === undefined
            ? {}
            : { label: String(dto.label ?? "").trim() || requirement.label }),
          ...(dto.minCount === undefined
            ? {}
            : { minCount: Math.max(1, Number(dto.minCount) || 1) }),
          ...(dto.responsibleUploader === undefined
            ? {}
            : { responsibleUploader: dto.responsibleUploader }),
          ...(dto.requirementStage === undefined
            ? {}
            : { requirementStage: dto.requirementStage }),
          ...(dto.sortOrder === undefined
            ? {}
            : { sortOrder: Number(dto.sortOrder) || 0 }),
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({
          code: "REQUIREMENT_TYPE_STAGE_DUPLICATE",
          message: `A document requirement already exists for ${nextType} at stage ${nextStage} on this trip (${tripDocumentRequirementDuplicateKey({ tenantId, tripId, type: nextType, requirementStage: nextStage })}).`,
        });
      }
      throw error;
    }

    await this.safeLogRequirementAudit(
      tenantId,
      "TRIP_DOCUMENT_REQUIREMENT_UPDATED",
      requirement.id,
      {
        jobId,
        tripId,
        before,
        after: {
          type: updated.type,
          label: updated.label,
          isRequired: updated.isRequired,
          requiresSignature: updated.requiresSignature,
          minCount: updated.minCount,
          sortOrder: updated.sortOrder,
          responsibleUploader: updated.responsibleUploader,
          requirementStage: updated.requirementStage,
        },
      },
      actorUserId,
    );
    return updated;
  }

  async deleteTripDocumentRequirement(
    tenantId: string,
    jobId: string,
    tripId: string,
    requirementId: string,
    user: any,
    confirmPreserveDocuments = false,
  ) {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const job = await this.prisma.job.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException("Job not found");
    this.assertCanAccessJob(job, user);
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
      select: { id: true, status: true },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    if (isTripDocumentRequirementFrozen(trip.status)) {
      throw new BadRequestException(
        "Document requirements are frozen after the trip is published.",
      );
    }
    const requirement = await this.prisma.tripDocumentRequirement.findFirst({
      where: { id: requirementId, tenantId, tripId },
    });
    if (!requirement) throw new NotFoundException("Document requirement not found");

    const matchingDocuments = await this.prisma.tripDocument.count({
      where: {
        tenantId,
        tripId,
        type: requirement.type,
        isActive: true,
      },
    });

    if (matchingDocuments > 0 && !confirmPreserveDocuments) {
      throw new ConflictException({
        code: "REQUIREMENT_HAS_DOCUMENTS",
        message:
          "This requirement has matching active documents. Confirm removal with confirmPreserveDocuments=true to keep documents and audit history.",
        matchingDocumentCount: matchingDocuments,
      });
    }

    await this.prisma.tripDocumentRequirement.delete({
      where: { id: requirement.id },
    });

    await this.safeLogRequirementAudit(
      tenantId,
      "TRIP_DOCUMENT_REQUIREMENT_REMOVED",
      requirement.id,
      {
        jobId,
        tripId,
        type: requirement.type,
        label: requirement.label,
        requirementStage: requirement.requirementStage,
        responsibleUploader: requirement.responsibleUploader,
        matchingDocumentCount: matchingDocuments,
        documentsPreserved: true,
        confirmPreserveDocuments: matchingDocuments > 0,
      },
      actorUserId,
    );

    return {
      ok: true,
      id: requirement.id,
      matchingDocumentCount: matchingDocuments,
      documentsPreserved: true,
    };
  }

  async createTripDocumentRequirement(
    tenantId: string,
    jobId: string,
    tripId: string,
    dto: CreateTripDocumentRequirementDto,
    user: any,
  ) {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const job = await this.prisma.job.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException("Job not found");
    this.assertCanAccessJob(job, user);
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, jobId },
      select: { id: true, status: true },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    if (isTripDocumentRequirementFrozen(trip.status)) {
      throw new BadRequestException(
        "Document requirements are frozen after the trip is published.",
      );
    }

    const type = dto.type;
    this.assertEditorResponsibleUploader(dto.responsibleUploader);
    const requiresSignature = dto.requiresSignature === true;
    if (requiresSignature && !documentTypeSupportsCustomerSignature(type)) {
      throw new BadRequestException(
        `Customer signature is not supported for ${type}.`,
      );
    }

    const defaultLabel =
      type === TripDocumentType.PERMIT
        ? "Permit"
        : type === TripDocumentType.DELIVERY_DO
          ? "Delivery DO"
          : type === TripDocumentType.PICKUP_DO
            ? "Pickup DO"
            : type === TripDocumentType.POD_PHOTO
              ? "POD Photo"
              : String(type).replace(/_/g, " ");

    const responsibleUploader =
      dto.responsibleUploader ??
      (type === TripDocumentType.PERMIT
        ? TripDocumentResponsibleUploader.OPERATIONS
        : TripDocumentResponsibleUploader.DRIVER);
    this.assertEditorResponsibleUploader(responsibleUploader);
    const requirementStage =
      dto.requirementStage ??
      (type === TripDocumentType.PERMIT
        ? TripDocumentRequirementStage.BEFORE_DISPATCH
        : TripDocumentRequirementStage.BEFORE_COMPLETE);

    const duplicate = await this.prisma.tripDocumentRequirement.findFirst({
      where: {
        tenantId,
        tripId,
        type,
        requirementStage,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({
        code: "REQUIREMENT_TYPE_STAGE_DUPLICATE",
        message: `A document requirement already exists for ${type} at stage ${requirementStage} on this trip (${tripDocumentRequirementDuplicateKey({ tenantId, tripId, type, requirementStage })}).`,
      });
    }

    const maxSort = await this.prisma.tripDocumentRequirement.aggregate({
      where: { tenantId, tripId },
      _max: { sortOrder: true },
    });

    let created;
    try {
      created = await this.prisma.tripDocumentRequirement.create({
        data: {
          tenantId,
          tripId,
          type,
          label: String(dto.label ?? "").trim() || defaultLabel,
          isRequired: dto.isRequired !== false,
          requiresSignature,
          minCount: Math.max(1, Number(dto.minCount ?? 1) || 1),
          sortOrder:
            dto.sortOrder ??
            (Number.isFinite(maxSort._max.sortOrder)
              ? Number(maxSort._max.sortOrder) + 1
              : 0),
          responsibleUploader,
          requirementStage,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({
          code: "REQUIREMENT_TYPE_STAGE_DUPLICATE",
          message: `A document requirement already exists for ${type} at stage ${requirementStage} on this trip (${tripDocumentRequirementDuplicateKey({ tenantId, tripId, type, requirementStage })}).`,
        });
      }
      throw error;
    }

    await this.safeLogRequirementAudit(
      tenantId,
      "TRIP_DOCUMENT_REQUIREMENT_CREATED",
      created.id,
      {
        jobId,
        tripId,
        type: created.type,
        label: created.label,
        isRequired: created.isRequired,
        requiresSignature: created.requiresSignature,
        minCount: created.minCount,
        sortOrder: created.sortOrder,
        responsibleUploader: created.responsibleUploader,
        requirementStage: created.requirementStage,
      },
      actorUserId,
    );
    return created;
  }

  private async safeLogRequirementAudit(
    tenantId: string,
    action: string,
    entityId: string,
    meta: Record<string, unknown>,
    actorUserId: string | null,
  ) {
    try {
      await this.audit.log(
        tenantId,
        action,
        "TRIP_DOCUMENT_REQUIREMENT",
        entityId,
        meta,
        actorUserId,
      );
    } catch (error) {
      const err = error as { name?: string; code?: string };
      this.logger.error(
        `Post-commit audit failed for ${action} ${entityId} (tenant=${tenantId}, code=${err?.code ?? "n/a"}, name=${err?.name ?? "Error"})`,
      );
    }
  }

  private assertEditorResponsibleUploader(
    uploader: TripDocumentResponsibleUploader | undefined | null,
  ) {
    if (uploader == null) return;
    if (
      uploader !== TripDocumentResponsibleUploader.DRIVER &&
      uploader !== TripDocumentResponsibleUploader.OPERATIONS
    ) {
      throw new BadRequestException(
        "Responsible uploader must be DRIVER or OPERATIONS",
      );
    }
  }

  private async seedDefaultDocumentRequirementsForJob(
    tenantId: string,
    jobId: string,
  ): Promise<void> {
    const trips = await this.prisma.trip.findMany({
      where: { tenantId, jobId },
      select: { id: true },
    });
    await ensureDefaultTripDocumentRequirementSnapshots(
      this.prisma,
      tenantId,
      trips.map((row) => row.id),
    );
  }

  private async resolveTripDocumentRequiresSignature(
    tenantId: string,
    tripId: string,
    type: TripDocumentType,
    fallback: boolean,
  ): Promise<boolean> {
    if (!documentTypeSupportsCustomerSignature(type)) return false;
    const snapshots = await this.loadTripDocumentRequirementSnapshots(tenantId, tripId);
    const row = requirementSnapshotForType(snapshots, type);
    if (row) return row.requiresSignature === true;
    return fallback === true;
  }

  private async loadTripDocumentRequirementSnapshots(
    tenantId: string,
    tripId: string,
  ): Promise<Array<{ type: TripDocumentType; isRequired: boolean; requiresSignature: boolean }>> {
    if (!this.prisma.tripDocumentRequirement?.findMany) return [];
    return this.prisma.tripDocumentRequirement.findMany({
      where: { tenantId, tripId },
      select: { type: true, isRequired: true, requiresSignature: true },
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
    assertTripPayoutMutable(trip.status);
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
      const cacheCents = payoutCacheCentsToPersist(normalized);
      await tx.trip.update({
        where: { id: tripId },
        data: {
          driverEarningCents: cacheCents,
          earningLabelSnapshot: normalized.length ? `${normalized.length} payout items` : null,
          updatedByUserId: actorUserId,
        },
      });
    });
    await this.audit.log(tenantId, "TRIP_PAYOUT_LINES_REPLACE", "TRIP", tripId, { lineCount: normalized.length }, actorUserId);
    const cacheCents = payoutCacheCentsToPersist(normalized);
    rt.publishTripEvent(this.realtime, "trip.updated", tenantId, jobId, tripId, {
      driverUserId: trip.assignedDriverUserId,
      tripStatus: trip.status as TripStatus,
      notificationKind: "EARNINGS_UPDATED",
      earningsAmountCents: cacheCents ?? undefined,
      ...this.notifyActorContext(user),
    });
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
    assertTripPayoutMutable(trip.status);

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
          line.sourceRateMasterItemId ?? line.payoutItemId ?? line.earningRateMasterId ?? null,
        payoutItemId: null as string | null,
        earningRateMasterId: null as string | null,
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
        if (typeof (sourceItem as { datasetId?: string }).datasetId === "string") {
          line.earningRateMasterId = sourceItem.id;
          line.payoutItemId = null;
        } else {
          line.payoutItemId = sourceItem.id;
          line.earningRateMasterId = null;
        }
      }
    }

    const totalDriverEarningCents = payoutCacheCentsToPersist(normalized);
    const selectedIsDataset =
      selectedMaster != null
      && typeof (selectedMaster as { datasetId?: string }).datasetId === "string";

    await this.prisma.$transaction(async (tx) => {
      await tx.tripPayoutLine.deleteMany({ where: { tenantId, tripId } });
      if (normalized.length) {
        // TripPayoutLine.amountCents/totalCents are frozen snapshots at save/finalize time.
        await tx.tripPayoutLine.createMany({
          data: normalized.map((line) => ({
            tenantId,
            tripId,
            sourceType: JobChargeSourceType.DRIVER_RATE_MASTER,
            payoutItemId: line.payoutItemId,
            earningRateMasterId: line.earningRateMasterId,
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
          earningRateMasterId: selectedIsDataset ? selectedMaster.id : null,
          payoutItemId: selectedMaster && !selectedIsDataset ? selectedMaster.id : null,
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

    rt.publishTripEvent(this.realtime, "trip.updated", tenantId, jobId, tripId, {
      driverUserId: trip.assignedDriverUserId,
      tripStatus: trip.status as TripStatus,
      notificationKind: "EARNINGS_UPDATED",
      earningsAmountCents: totalDriverEarningCents ?? undefined,
      ...this.notifyActorContext(user),
    });

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
      const collectionTypeRaw = get(row, 8).toUpperCase();

      let jobType: JobType;
      if (jobTypeStr === "LCL") jobType = JobType.LCL;
      else if (jobTypeStr === "IMPORT") jobType = JobType.IMPORT;
      else if (jobTypeStr === "EXPORT") jobType = JobType.EXPORT;
      else if (jobTypeStr === "COLLECTION") jobType = JobType.COLLECTION;
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
      if (collectionTypeRaw === CollectionType.EMPTY || collectionTypeRaw === CollectionType.LOADED) {
        (data as any).collectionType = collectionTypeRaw as CollectionType;
      }

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
    if (!jobType || !["LCL", "IMPORT", "EXPORT", "COLLECTION"].includes(jobType)) {
      errors.push("jobType must be LCL, IMPORT, EXPORT, or COLLECTION");
    }
    if (jobType === JobType.COLLECTION) {
      try {
        resolveCollectionTypeForJobCreate(JobType.COLLECTION, row.collectionType);
      } catch (e: any) {
        errors.push(e?.message ?? "collectionType is required for COLLECTION");
      }
    }
    if (!row.pickupAddress?.trim()) errors.push("pickupAddress is required");
    if (!row.deliveryAddress?.trim())
      errors.push("deliveryAddress is required");

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
            : row.jobType === "COLLECTION"
              ? JobType.COLLECTION
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
        const collectionType = resolveCollectionTypeForJobCreate(
          jobType,
          row.collectionType,
        );

        const job = await this.prisma.job.create({
          data: {
            tenantId,
            customerCompanyId,
            internalRef,
            jobType,
            collectionType,
            status: JobStatus.ONGOING,
            createdByUserId: actorUserId,
            pickupDate: pickupDateParsed,
            pickupAddress1: row.pickupAddress,
            pickupAddress2: (row as any).pickupAddress2 ?? null,
            pickupPostal: (row as any).pickupPostal ?? null,
            deliveryAddress1: row.deliveryAddress,
            deliveryAddress2: (row as any).deliveryAddress2 ?? null,
            deliveryPostal: (row as any).deliveryPostal ?? null,
            receiverName: row.receiverName?.trim() ?? "",
            receiverPhone: row.receiverPhone?.trim() ?? "",
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

        await this.prisma.jobTypeAssignment.createMany({
          data: [
            {
              tenantId,
              jobId: job.id,
              jobType,
            },
          ],
          skipDuplicates: true,
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
            { createdByUserId: actorUserId, tripType: jobType },
          ),
        });

        await this.seedDefaultDocumentRequirementsForJob(tenantId, job.id);

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
      const errors = validateJobBatchImportRowFields(data, {
        jobType: params.jobType,
      });
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
      const fieldErrors = validateJobBatchImportRowFields(row, {
        jobType: dto.jobType,
      });
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

        await this.prisma.jobTypeAssignment.createMany({
          data: [{ tenantId, jobId: job.id, jobType: dto.jobType }],
          skipDuplicates: true,
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
            { createdByUserId: actorUserId, tripType: dto.jobType },
          ),
        });

        await this.seedDefaultDocumentRequirementsForJob(tenantId, job.id);

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

      const orderRef = TransportJobsService.cell(row, idx.orderRef);
      if (!orderRef) continue;

      const deliveryAddress1 = TransportJobsService.cell(row, idx.deliveryAddress1);
      const deliveryAddress2 =
        idx.deliveryAddress2 >= 0
          ? TransportJobsService.cell(row, idx.deliveryAddress2)
          : "";
      const deliveryCity =
        idx.deliveryCity >= 0 ? TransportJobsService.cell(row, idx.deliveryCity) : "";
      const deliveryPostalCode =
        idx.deliveryPostalCode >= 0
          ? TransportJobsService.cell(row, idx.deliveryPostalCode)
          : "";
      const deliveryCountry =
        idx.deliveryCountry >= 0
          ? TransportJobsService.cell(row, idx.deliveryCountry)
          : "";
      const deliveryFirstName =
        idx.deliveryFirstName >= 0
          ? TransportJobsService.cell(row, idx.deliveryFirstName)
          : "";
      const deliveryLastName =
        idx.deliveryLastName >= 0
          ? TransportJobsService.cell(row, idx.deliveryLastName)
          : "";
      const firstName =
        idx.firstName >= 0 ? TransportJobsService.cell(row, idx.firstName) : "";
      const lastName =
        idx.lastName >= 0 ? TransportJobsService.cell(row, idx.lastName) : "";
      const phone =
        idx.phone >= 0 ? TransportJobsService.normalizePhone(row[idx.phone]) : "";
      const mobile =
        idx.mobile >= 0 ? TransportJobsService.normalizePhone(row[idx.mobile]) : "";
      const itemCode =
        idx.itemCode >= 0 ? TransportJobsService.cell(row, idx.itemCode) : "";
      const itemQty =
        idx.itemQty >= 0 ? TransportJobsService.cell(row, idx.itemQty) : "";
      const specialRequest =
        idx.specialRequest >= 0
          ? TransportJobsService.cell(row, idx.specialRequest)
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
            receiverName: row.receiverName?.trim() ?? "",
            receiverPhone: row.receiverPhone?.trim() ?? "",
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

        await this.prisma.jobTypeAssignment.createMany({
          data: [{ tenantId, jobId: job.id, jobType: JobType.LCL }],
          skipDuplicates: true,
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
            { createdByUserId: actorUserId, tripType: JobType.LCL },
          ),
        });

        await this.seedDefaultDocumentRequirementsForJob(tenantId, job.id);

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
      pickupAddress1?: string | null;
      pickupAddress2?: string | null;
      pickupPostal?: string | null;
      pickupContactName?: string | null;
      pickupContactPhone?: string | null;
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
      variant?: "pickup" | "delivery";
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
  
    const variant = options?.variant ?? "delivery";
    const isPickup = variant === "pickup";

    const contactName =
      options?.recipientName?.trim()
      || (isPickup
        ? job.pickupContactName?.trim()
        : (job.podRecipientName?.trim() || job.receiverName?.trim()))
      || "-";

    const contactPhone = isPickup
      ? (job.pickupContactPhone?.trim() || "-")
      : (job.receiverPhone?.trim() || "-");
    const specialRequest = job.notes?.trim() || "-";

    const addressBlock =
      isPickup
        ? [
            job.pickupAddress1,
            job.pickupAddress2,
            job.pickupPostal ? `Singapore ${job.pickupPostal}` : null,
          ]
        : [
            job.deliveryAddress1,
            job.deliveryAddress2,
            job.deliveryPostal ? `Singapore ${job.deliveryPostal}` : null,
          ];
    const addressText =
      addressBlock
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
      path.resolve(process.cwd(), "src/transport/jobs/assets/db-logo.png"),
      path.resolve(process.cwd(), "dist/transport/jobs/assets/db-logo.png"),
      path.resolve(process.cwd(), "dist/src/transport/jobs/assets/db-logo.png"),
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
      {
        label: isPickup ? "Pickup Address" : "Delivery Adress",
        width: 235,
      },
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
        contactName,
        contactPhone,
        addressText,
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
      contactName,
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
      contactPhone,
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
      addressText,
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
  
    // ===== SIGNATURE IMAGE =====
    if (options?.signatureImageBytes) {
      try {
        const normalizedSignatureBytes = await normalizeSignatureImageForPdf(
          options.signatureImageBytes,
        );
        let signatureImage;
        try {
          signatureImage = await pdfDoc.embedPng(normalizedSignatureBytes);
        } catch {
          signatureImage = await pdfDoc.embedJpg(normalizedSignatureBytes);
        }

        const drawRect = computeDoSignatureImageDrawRect({
          tableX,
          signLineY,
          declarationY,
          imageWidthPx: signatureImage.width,
          imageHeightPx: signatureImage.height,
        });

        if (drawRect.width > 0 && drawRect.height > 0) {
          page.drawImage(signatureImage, drawRect);
        }
      } catch {
        // ignore bad signature image
      }
    }

    const signerName = options?.recipientName?.trim() || null;
    const signatureLabel = signerName
      ? `Signature/Name/NRIC No.: ${signerName}`
      : "Signature/Name/NRIC No.";

    page.drawText(signatureLabel, {
      x: tableX,
      y: signLineY - 18,
      size: 10,
      font,
      color: black,
    });

    if (options?.signedAt) {
      page.drawText(`Signed at: ${this.formatDoSignedAt(options.signedAt)}`, {
        x: tableX,
        y: signLineY - 34,
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

  private formatDoSignedAt(value?: Date | string | null): string {
    if (!value) return "-";
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString("en-SG", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
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

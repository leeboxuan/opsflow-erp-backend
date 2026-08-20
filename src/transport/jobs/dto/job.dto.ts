import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  CollectionType,
  JobType,
  JobStatus,
  JobTripTemplate,
  JobChargeSourceType,
  InvoiceStatus,
} from "@prisma/client";

export class JobDocumentDto {
  @ApiPropertyOptional()
  id: string;

  @ApiPropertyOptional()
  type: string;

  @ApiPropertyOptional()
  originalName: string;

  @ApiPropertyOptional()
  mimeType: string;

  @ApiPropertyOptional()
  sizeBytes?: number | null;

  /** Primary display/download filename (stored original or derived from object path). */
  @ApiPropertyOptional()
  fileName?: string;

  /** Original uploaded filename when stored; otherwise null. */
  @ApiPropertyOptional()
  originalFileName?: string | null;

  /** Same as sizeBytes when known; included for trip/document list parity with mobile clients. */
  @ApiPropertyOptional()
  fileSizeBytes?: number | null;

  @ApiPropertyOptional()
  isActive?: boolean | null;

  @ApiPropertyOptional()
  createdAt: Date;

  @ApiPropertyOptional()
  updatedAt?: Date | null;

  @ApiPropertyOptional()
  url?: string | null;

  @ApiPropertyOptional()
  uploadedByUserId?: string | null;

  @ApiPropertyOptional()
  uploadedByName?: string | null;

  @ApiPropertyOptional()
  uploadedByEmail?: string | null;

  @ApiPropertyOptional({ description: "Alias for createdAt on upload timestamp." })
  uploadedAt?: Date;

  @ApiPropertyOptional()
  generatedBySystem?: boolean | null;

  @ApiPropertyOptional()
  generatedSource?: string | null;

  @ApiPropertyOptional()
  jobId?: string | null;

  @ApiPropertyOptional()
  tripId?: string | null;

  @ApiPropertyOptional({
    description:
      "Linked JobItem id for CONTAINER_PHOTO/SEAL_PHOTO; null for trip-level documents.",
    nullable: true,
  })
  jobItemId?: string | null;

  @ApiPropertyOptional()
  signedByUserId?: string | null;

  @ApiPropertyOptional()
  downloadUrl?: string | null;

  @ApiPropertyOptional()
  previewUrl?: string | null;

  @ApiPropertyOptional()
  requiresSignature?: boolean | null;

  @ApiPropertyOptional()
  isSigned?: boolean | null;

  @ApiPropertyOptional()
  signedAt?: Date | null;

  @ApiPropertyOptional()
  signedByName?: string | null;
}

export class TripDocumentRequirementDto {
  id!: string;
  type!: string;
  label!: string;
  isRequired!: boolean;
  requiresSignature!: boolean;
  minCount!: number;
  sortOrder!: number;
  responsibleUploader!: string;
  requirementStage!: string;
}

export class EvaluatedTripDocumentRequirementDto {
  requirementId!: string | null;
  type!: string;
  label!: string;
  isRequired!: boolean;
  minCount!: number;
  satisfiedCount!: number;
  missingCount!: number;
  requiresSignature!: boolean;
  signatureSatisfied!: boolean;
  responsibleUploader!: string;
  requirementStage!: string;
  satisfiedState!: string;
  blockingAction!: string;
  blockingActor!: string;
  blocksLifecycle!: boolean;
}

export class TripDocumentReadinessDto {
  evaluationSource!: string;
  readinessStatus!: string;
  totalMissingCount!: number;
  blockingAction!: string;
  blockingActor!: string;
  missingTypeCodes!: string[];
  summaryLabels!: string[];
  requirements!: EvaluatedTripDocumentRequirementDto[];
}

export class JobListDocumentReadinessDto {
  readinessStatus!: string;
  missingDocumentCount!: number;
  missingLabels!: string[];
  blockingActor!: string;
  /** Trip id to navigate when a single trip owns the primary gap; null when job-level. */
  primaryTripId!: string | null;
}


export class JobTripLocationDto {
  label!: string | null;
  addressLine1!: string | null;
  addressLine2!: string | null;
  postalCode!: string | null;
  country!: string | null;
  lat!: number | null;
  lng!: number | null;
  placeId!: string | null;
  locationId!: string | null;
}

export class JobTripLiveTrackingDto {
  isTrackable!: boolean;
  hasStarted!: boolean;
  driverLat!: number | null;
  driverLng!: number | null;
  lastSeenAt!: Date | null;
  isStale!: boolean;
  destinationLat!: number | null;
  destinationLng!: number | null;
}

export class JobTripPayoutLineDto {
  id!: string;
  label!: string;
  code!: string | null;
  amountCents!: number | null;
  requiresManualAmount!: boolean;
  isSelectableForTripEarning!: boolean;
  sortOrder!: number;
  payoutItemId?: string | null;
  earningRateMasterId?: string | null;
}

export class JobTripResponseDto {
  id!: string;
  jobId!: string | null;
  jobSequence!: number | null;
  tripSequence!: number | null;
  tripDisplayRef!: string | null;
  jobTripTemplate!: JobTripTemplate | null;
  title!: string | null;
  displayTitle!: string | null;
  createdAt!: Date | null;
  createdByUserId!: string | null;
  updatedByUserId!: string | null;
  updatedByName!: string | null;
  publishedAt!: Date | null;
  publishedByUserId!: string | null;
  assignedAt!: Date | null;
  assignedByUserId!: string | null;
  /** Tenant user id of the assigned driver (for mobile trip filtering). */
  @ApiPropertyOptional({ nullable: true })
  assignedDriverUserId!: string | null;
  assignedDriverName!: string | null;
  driverId!: string | null;
  driverName!: string | null;
  vehicleType!: string | null;
  customerCompanyName!: string | null;
  contactName!: string | null;
  contactPhone!: string | null;
  tripPICName!: string | null;
  tripPICContact!: string | null;
  containerNumber!: string | null;
  carrier!: string | null;
  shipper!: string | null;
  vessel!: string | null;
  fromLabel!: string | null;
  toLabel!: string | null;
  fromAddress!: string | null;
  toAddress!: string | null;
  fromType!: string | null;
  toType!: string | null;
  originSummary!: string | null;
  destinationSummary!: string | null;
  @ApiPropertyOptional()
  originAddress1?: string | null;
  @ApiPropertyOptional()
  originAddress2?: string | null;
  @ApiPropertyOptional()
  originPostalCode?: string | null;
  @ApiPropertyOptional()
  originPlaceId?: string | null;
  @ApiPropertyOptional()
  originLat?: number | null;
  @ApiPropertyOptional()
  originLng?: number | null;
  @ApiPropertyOptional()
  destinationAddress1?: string | null;
  @ApiPropertyOptional()
  destinationAddress2?: string | null;
  @ApiPropertyOptional()
  destinationPostalCode?: string | null;
  @ApiPropertyOptional()
  destinationPlaceId?: string | null;
  @ApiPropertyOptional()
  destinationLat?: number | null;
  @ApiPropertyOptional()
  destinationLng?: number | null;
  /** Trip-specific ops/driver instructions (Trip.notes). */
  @ApiPropertyOptional()
  notes?: string | null;
  /** Driver-owned remarks (Trip.driverRemarks). */
  @ApiPropertyOptional()
  driverRemarks?: string | null;
  /** ISO timestamp of last driver remarks audit change when remarks are present. */
  @ApiPropertyOptional()
  driverRemarksUpdatedAt?: string | null;
  /** Job-level notes (Job.notes). */
  @ApiPropertyOptional()
  jobNotes?: string | null;
  @ApiPropertyOptional()
  tripInstruction?: string | null;
  origin!: JobTripLocationDto | null;
  destination!: JobTripLocationDto | null;
  status!: string;
  isPublished!: boolean;
  isCompleted!: boolean;
  pendingState!: string | null;
  canPublish!: boolean;
  canMarkDone!: boolean;
  plannedStartAt!: Date | null;
  startedAt!: Date | null;
  closedAt!: Date | null;
  trailerNumber!: string | null;
  trailerLastLocationCode!: string | null;
  driverEarningCents!: number | null;
  hasDriverPayout!: boolean;
  earningLabelSnapshot!: string | null;
  earningRateMasterId!: string | null;
  assignedVehicleId!: string | null;
  assignedVehiclePlateNo!: string | null;
  liveTracking!: JobTripLiveTrackingDto;
  payoutLines!: JobTripPayoutLineDto[];
  driverEarningCentsTotal!: number | null;
  /** Populated on driver detail when trip documents are loaded */
  documents?: JobDocumentDto[];
  documentStatus?: {
    pickupDo: "PENDING" | "UPLOADED" | "GENERATED" | "SIGNED";
    deliveryDo: "PENDING" | "UPLOADED" | "GENERATED" | "SIGNED";
    podSignature: "PENDING" | "UPLOADED" | "GENERATED" | "SIGNED";
    receiverDo: "PENDING" | "UPLOADED" | "GENERATED" | "SIGNED";
    podPhoto?: "PENDING" | "UPLOADED" | "GENERATED" | "SIGNED";
    trailerStartPhoto?: "PENDING" | "UPLOADED" | "GENERATED" | "SIGNED";
    trailerEndPhoto?: "PENDING" | "UPLOADED" | "GENERATED" | "SIGNED";
  };
  completionRuleJson?: Record<string, unknown> | null;

  /** Per-trip snapshot of required documents and whether customer signature is required. */
  documentRequirements?: TripDocumentRequirementDto[];

  /** Canonical evaluation of documentRequirements against active documents. */
  documentReadiness?: TripDocumentReadinessDto;

  @ApiPropertyOptional({
    description:
      "Trip includes a PSA port stop and requires an authorised driver.",
  })
  requiresPsaPortAccess?: boolean;

  @ApiPropertyOptional({
    description:
      "True when assigned driver lacks PSA access required by this trip. Does not auto-unassign.",
  })
  psaEligibilityConflict?: boolean;

  @ApiPropertyOptional({
    enum: ["NONE", "BLOCK_PUBLISH", "URGENT"],
    description: "Severity of PSA eligibility conflict for ops/driver UI.",
  })
  psaEligibilityConflictSeverity?: "NONE" | "BLOCK_PUBLISH" | "URGENT";

  @ApiPropertyOptional({
    description: "Human-readable PSA eligibility conflict message.",
  })
  psaEligibilityConflictMessage?: string | null;

  /** Driver active/home: job ref on the trip row (same as parent job when linked). */
  @ApiPropertyOptional()
  jobInternalRef?: string | null;

  @ApiPropertyOptional()
  customerName?: string | null;

  @ApiPropertyOptional({ enum: JobType })
  jobType?: JobType;

  @ApiPropertyOptional({ enum: JobType })
  tripType?: JobType | null;

  @ApiPropertyOptional({ enum: ["CANONICAL", "LEGACY_FALLBACK"] })
  tripTypeSource?: "CANONICAL" | "LEGACY_FALLBACK";

  /** Resolved pickup lines (trip origin route, else job pickup). */
  @ApiPropertyOptional()
  pickupAddress1?: string | null;

  @ApiPropertyOptional()
  pickupAddress2?: string | null;

  @ApiPropertyOptional()
  pickupPostal?: string | null;

  /** Resolved delivery lines (trip destination route, else job delivery). */
  @ApiPropertyOptional()
  deliveryAddress1?: string | null;

  @ApiPropertyOptional()
  deliveryAddress2?: string | null;

  @ApiPropertyOptional()
  deliveryPostal?: string | null;
}

export class JobChargeResponseDto {
  id!: string;
  sourceType!: JobChargeSourceType;
  sourceRefId!: string | null;
  sourceCustomerQuotationItemId?: string | null;
  sourceCustomerQuotationLineId?: string | null;
  provenanceLabel?: string | null;
  code!: string;
  label!: string;
  description!: string | null;
  qty!: number;
  unitPriceCents!: number;
  amountCents!: number;
  currency!: string;
  taxable!: boolean;
  taxCode!: string | null;
  taxRateBasisPoints!: number | null;
  sortOrder!: number;
  metadataJson?: Record<string, unknown> | null;
}

/** Slim row for GET /api/jobs list (table view). Full detail: GET /api/jobs/:id. */
export class JobListTripProgressDto {
  @ApiProperty()
  completed!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  isComplete!: boolean;
}

export class JobListInvoiceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: InvoiceStatus })
  status!: InvoiceStatus;
}

export class JobListItemDto {
  id!: string;
  tenantId!: string;
  customerCompanyId!: string;
  companyName?: string | null;
  internalRef!: string;
  externalRef?: string | null;
  jobType!: JobType;
  jobTypes?: JobType[];
  jobTypeSource?: "CANONICAL" | "LEGACY_FALLBACK";
  /** COLLECTION only; null for other job types. */
  collectionType?: CollectionType | null;
  status!: JobStatus;
  pickupDate!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
  assignedDriverId?: string | null;
  assignedDriverName?: string | null;
  tripCount!: number;
  itemCount!: number;
  /** Active job-level documents (quotation/other); trip photos are separate. */
  documentCount!: number;
  /** Canonical trip-document readiness across non-cancelled trips (not job-level documentCount). */
  documentReadiness!: JobListDocumentReadinessDto;
  tripProgress!: JobListTripProgressDto;
  invoice!: JobListInvoiceDto | null;
}

export class DocumentSignedUrlDto {
  previewUrl!: string | null;
  downloadUrl!: string | null;
  expiresInSeconds!: number;
}

export class JobDto {
  id: string;
  tenantId: string;
  customerCompanyId: string;
  companyName?: string | null;
  sourceCustomerQuotationId?: string | null;
  sourceCustomerQuotationNo?: string | null;
  sourceCustomerQuotationTitle?: string | null;

  internalRef: string;
  externalRef?: string | null;
  /** Compatibility singular type (synced to first deterministic jobTypes entry). */
  jobType: JobType;
  /** Canonical multi-value types (deterministic order). */
  jobTypes?: JobType[];
  jobTypeSource?: "CANONICAL" | "LEGACY_FALLBACK";
  /** COLLECTION only; null for other job types. */
  collectionType?: CollectionType | null;
  status: JobStatus;
  invoiceReadyAt?: Date | null;
  isInvoiceReady?: boolean;
  computedInvoiceReady?: boolean;
  computedInvoiceReadinessReason?: string | null;
  notes?: string | null;

  /** Job-level pickup reference (container-style). Legacy item-level values fall back on read. */
  pickupReference?: string | null;
  /** Job-level description (all types). Distinct from LCL item descriptions. */
  description?: string | null;
  carrierName?: string | null;
  voyage?: string | null;
  shipper?: string | null;

  createdByUserId?: string | null;
  createdByName?: string | null;
  createdByEmail?: string | null;

  pickupPortCode?: string | null;
  portTerminalCode?: string | null;
  portName?: string | null;
  psaStorageRentLastDay?: Date | null;
  vesselName?: string | null;
  vesselEta?: Date | null;
  portnetReady?: boolean;
  permitReady?: boolean;
  returningDepotCode?: string | null;
  returnLastDay?: Date | null;
  exportOriginDepotCode?: string | null;
  exportPortCode?: string | null;

  pickupDate: Date | null;
  pickupAddress1: string;
  pickupAddress2: string | null;
  pickupPostal: string | null;
  /** From primary trip origin snapshot when trips are loaded. */
  pickupPlaceId?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  pickupContactName: string | null;
  pickupContactPhone: string | null;

  deliveryAddress1: string;
  deliveryAddress2: string | null;
  deliveryPostal: string | null;
  /** From primary trip destination snapshot when trips are loaded. */
  deliveryPlaceId?: string | null;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
  receiverName: string;
  receiverPhone: string;

  assignedDriverId: string | null;
  assignedDriverName?: string | null;
  assignedVehicleId: string | null;
  assignedFleetVehicleId?: string | null;
  assignedVehiclePlateNo?: string | null;

  assignedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  deliveredAt: Date | null;
  podRecipientName: string | null;

  cancelledReason: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;

  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: Date | null;

  createdAt: Date;
  updatedAt: Date;

  documents?: JobDocumentDto[];
  items?: JobItemDto[];
  trips?: JobTripResponseDto[];
  charges?: JobChargeResponseDto[];
}

export class JobTrackingDto {
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: Date | null;
  assignedDriverId: string | null;
  assignedVehicleId: string | null;
  assignedFleetVehicleId?: string | null;
  status: JobStatus;
}

export class AuditLogEntryDto {
  id: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export class JobItemDto {
  id: string;
  tenantId: string;
  jobId: string;
  itemCode: string;
  description: string | null;
  sealNo: string | null;
  /** API alias for sealNo when clients prefer sealNumber. */
  sealNumber?: string | null;
  /**
   * Deprecated for container-style jobs: use JobDto.pickupReference.
   * May be null on new container rows; legacy rows may still have a value.
   */
  pickupReference: string | null;
  qty: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export class JobDetailsTripPayoutLineDto {
  id!: string;
  sourceType!: JobChargeSourceType;
  payoutItemId!: string | null;
  earningRateMasterId!: string | null;
  code!: string | null;
  label!: string;
  description!: string | null;
  unit!: string | null;
  quantity!: number;

  @ApiPropertyOptional({ description: "Stored payout rate in integer cents." })
  amountCents!: number | null;

  @ApiPropertyOptional({ description: "Stored payout line total in integer cents." })
  totalCents!: number | null;

  @ApiProperty({ description: "Effective line total in integer cents." })
  effectiveTotalCents!: number;

  isManual!: boolean;
  requiresManualAmount!: boolean;
  isSelectableForTripEarning!: boolean;
  sortOrder!: number;
}

export class JobDetailsTripDto {
  id!: string;
  tripDisplayRef!: string;
  tripSequence!: number | null;
  jobSequence!: number | null;
  displayTitle!: string | null;
  status!: string;
  tripType?: string | null;
  tripTypeSource?: "CANONICAL" | "LEGACY_FALLBACK";
  assignedDriverUserId!: string | null;
  driverId!: string | null;
  assignedDriverName!: string | null;
  assignedVehiclePlateNo!: string | null;
  plannedStartAt!: Date | null;
  startedAt!: Date | null;
  closedAt!: Date | null;
  stopCount!: number;
  containerCount!: number;

  @ApiProperty({ description: "Canonical selectable payout total in integer cents." })
  payoutTotalCents!: number;

  payoutLines!: JobDetailsTripPayoutLineDto[];
  documents!: JobDocumentDto[];

  @ApiPropertyOptional({ description: "Trip origin label for compact Job Details summaries." })
  fromLabel?: string | null;

  @ApiPropertyOptional({ description: "Trip destination label for compact Job Details summaries." })
  toLabel?: string | null;

  @ApiPropertyOptional()
  pendingState?: string | null;

  @ApiPropertyOptional()
  jobTripTemplate?: string | null;

  @ApiPropertyOptional({
    description: "Linked cargo labels from TripJobItem (not Trip.containerNumber).",
    type: [String],
  })
  cargoLabels?: string[];

  @ApiPropertyOptional({
    description: "Count of incomplete trip document requirements from canonical evaluation.",
  })
  incompleteDocumentCount?: number;

  @ApiPropertyOptional({ type: TripDocumentReadinessDto })
  documentReadiness?: TripDocumentReadinessDto;

  @ApiPropertyOptional({
    description:
      "Trip includes a PSA port stop and requires an authorised driver.",
  })
  requiresPsaPortAccess?: boolean;

  @ApiPropertyOptional()
  psaEligibilityConflict?: boolean;

  @ApiPropertyOptional({ enum: ["NONE", "BLOCK_PUBLISH", "URGENT"] })
  psaEligibilityConflictSeverity?: "NONE" | "BLOCK_PUBLISH" | "URGENT";

  @ApiPropertyOptional()
  psaEligibilityConflictMessage?: string | null;
}

export class JobPayoutSummaryDto {
  @ApiProperty({ example: "SGD" })
  currency!: string;

  @ApiProperty({ description: "Job payout total in integer cents." })
  totalCents!: number;

  @ApiProperty({ description: "All trips attached to the job, including cancelled trips." })
  totalTrips!: number;

  @ApiProperty({ description: "Non-cancelled trips with an effective payout above zero." })
  tripsWithPayout!: number;

  @ApiProperty({ description: "Non-cancelled trips with no effective payout." })
  tripsWithoutPayout!: number;
}

export class JobContainerSummaryItemDto {
  id!: string;
  tripJobItemId!: string | null;
  itemCode!: string;
  sealNo!: string | null;
  description!: string | null;
  qty!: number | null;
  pickupReference!: string | null;
  tripId!: string | null;
  tripDisplayRef!: string | null;
  containerNumberSnapshot!: string | null;
}

export class JobContainerSummaryDto {
  @ApiProperty({ description: "Distinct JobItem records attached to the job." })
  totalContainers!: number;

  @ApiProperty({ description: "Non-cancelled trips with canonical TripJobItem links." })
  tripsWithContainers!: number;

  @ApiProperty({ description: "Non-cancelled trips without canonical TripJobItem links." })
  tripsWithoutContainers!: number;

  containers!: JobContainerSummaryItemDto[];
}

export class JobDetailsDto {
  job!: JobDto;
  payoutSummary!: JobPayoutSummaryDto;
  containerSummary!: JobContainerSummaryDto;
  trips!: JobDetailsTripDto[];
}
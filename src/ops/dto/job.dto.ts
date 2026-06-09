import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  CollectionType,
  JobType,
  JobStatus,
  JobTripTemplate,
  JobChargeSourceType,
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
    pickupDo: "PENDING" | "UPLOADED";
    deliveryDo: "GENERATED" | "UPLOADED";
    podSignature: "PENDING" | "UPLOADED";
    receiverDo: "PENDING" | "UPLOADED";
  };
  completionRuleJson?: Record<string, unknown> | null;

  /** Driver active/home: job ref on the trip row (same as parent job when linked). */
  @ApiPropertyOptional()
  jobInternalRef?: string | null;

  @ApiPropertyOptional()
  customerName?: string | null;

  @ApiPropertyOptional({ enum: JobType })
  jobType?: JobType;

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

  /** Job-level notes surfaced on the trip card. */
  @ApiPropertyOptional()
  notes?: string | null;
}

export class JobChargeResponseDto {
  id!: string;
  sourceType!: JobChargeSourceType;
  sourceRefId!: string | null;
  sourceCustomerQuotationItemId?: string | null;
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
export class JobListItemDto {
  id!: string;
  tenantId!: string;
  customerCompanyId!: string;
  companyName?: string | null;
  internalRef!: string;
  externalRef?: string | null;
  jobType!: JobType;
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

  internalRef: string;
  externalRef?: string | null;
  jobType: JobType;
  /** COLLECTION only; null for other job types. */
  collectionType?: CollectionType | null;
  status: JobStatus;
  invoiceReadyAt?: Date | null;
  isInvoiceReady?: boolean;
  computedInvoiceReady?: boolean;
  computedInvoiceReadinessReason?: string | null;
  notes?: string | null;

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
  pickupContactName: string | null;
  pickupContactPhone: string | null;

  deliveryAddress1: string;
  deliveryAddress2: string | null;
  deliveryPostal: string | null;
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
  pickupReference: string | null;
  qty: number | null;
  createdAt: Date;
  updatedAt: Date;
}
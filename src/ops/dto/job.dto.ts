import { ApiPropertyOptional } from "@nestjs/swagger";
import {
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
  jobTripTemplate!: JobTripTemplate | null;
  title!: string | null;
  displayTitle!: string | null;
  createdAt!: Date | null;
  createdByUserId!: string | null;
  publishedAt!: Date | null;
  publishedByUserId!: string | null;
  assignedDriverUserId!: string | null;
  assignedDriverName!: string | null;
  driverId!: string | null;
  driverName!: string | null;
  vehicleType!: string | null;
  customerCompanyName!: string | null;
  contactName!: string | null;
  contactPhone!: string | null;
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

export class JobDto {
  id: string;
  tenantId: string;
  customerCompanyId: string;
  companyName?: string | null;

  internalRef: string;
  externalRef?: string | null;
  jobType: JobType;
  status: JobStatus;
  invoiceReadyAt?: Date | null;
  isInvoiceReady?: boolean;
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
  qty: number;
  createdAt: Date;
  updatedAt: Date;
}
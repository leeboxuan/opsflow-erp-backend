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
  createdAt: Date;

  @ApiPropertyOptional()
  url?: string | null;
}

export class JobTripResponseDto {
  id!: string;
  jobSequence!: number | null;
  jobTripTemplate!: JobTripTemplate | null;
  title!: string | null;
  status!: string;
  plannedStartAt!: Date | null;
  startedAt!: Date | null;
  closedAt!: Date | null;
  trailerNumber!: string | null;
  trailerLastLocationCode!: string | null;
  driverEarningCents!: number | null;
  earningLabelSnapshot!: string | null;
  earningRateMasterId!: string | null;
  /** Populated on driver detail when trip documents are loaded */
  documents?: JobDocumentDto[];
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
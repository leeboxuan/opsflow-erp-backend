import { ApiPropertyOptional } from "@nestjs/swagger";
import { JobType, JobStatus } from "@prisma/client";

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
}

export class JobTrackingDto {
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: Date | null;
  assignedDriverId: string | null;
  assignedVehicleId: string | null;
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
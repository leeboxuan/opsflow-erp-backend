import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsOptional,
  ValidateIf,
  IsString,
  IsDateString,
  MinLength,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  IsBoolean,
  IsNotEmpty,
} from "class-validator";
import { CollectionType, JobType } from "@prisma/client";
import { Type } from "class-transformer";


export class CreateJobItemDto {
  @ApiPropertyOptional({ description: "LCL item code; container types may use containerNumber instead" })
  @IsOptional()
  @IsString()
  itemCode?: string;

  @ApiPropertyOptional({
    description: "IMPORT/EXPORT/COLLECTION: stored as itemCode when itemCode omitted",
  })
  @IsOptional()
  @IsString()
  containerNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sealNo?: string;

  @ApiPropertyOptional({
    description: "IMPORT/EXPORT/COLLECTION: optional per-container pickup reference",
  })
  @IsOptional()
  @IsString()
  pickupReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: "LCL quantity; optional for container-style job types" })
  @IsOptional()
  @IsNumber()
  qty?: number;

}

export class CreateJobImportDetailsDto {
  @ApiPropertyOptional({
    description:
      "Legacy/FE alias: logistics location id for import pickup port; converted to pickupPortCode server-side",
  })
  @IsOptional()
  @IsString()
  pickupPortId?: string;

  @ApiPropertyOptional({ description: "Required for IMPORT; must match master_singapore_ports.code" })
  @IsOptional()
  @IsString()
  pickupPortCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  portTerminalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  portName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  psaStorageRentLastDay?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vesselName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  vesselEta?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  portnetReady?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  permitReady?: boolean;

  @ApiPropertyOptional({
    description:
      "Optional IMPORT return depot code (master_singapore_depots.code). When omitted, only one port → delivery trip is generated.",
  })
  @IsOptional()
  @IsString()
  returningDepotCode?: string;

  @ApiPropertyOptional({
    description:
      "Legacy/FE alias: optional logistics location id for return depot; converted to returningDepotCode server-side",
  })
  @IsOptional()
  @IsString()
  returningDepotId?: string;

  @ApiPropertyOptional({
    description:
      "Optional container return due date. Does not require or imply a return depot/trip when omitted.",
  })
  @IsOptional()
  @IsDateString()
  returnLastDay?: string;
}

export class CreateJobExportDetailsDto {
  @ApiPropertyOptional({
    description:
      "Legacy/FE alias: logistics location id for export pickup depot; converted server-side",
  })
  @IsOptional()
  @IsString()
  pickupDepotId?: string | null;

  @ApiPropertyOptional({
    description:
      "Legacy/FE alias: logistics location id for return depot (ignored for EXPORT routing)",
  })
  @IsOptional()
  @IsString()
  returnDepotId?: string | null;

  @ApiPropertyOptional({
    description:
      "Legacy/FE alias: logistics location id for export port (optional context)",
  })
  @IsOptional()
  @IsString()
  exportPortId?: string | null;

  @ApiPropertyOptional({
    description:
      "Container pickup source depot code (master_singapore_depots.code)",
  })
  @IsOptional()
  @IsString()
  pickupDepotCode?: string;

  @ApiPropertyOptional({
    description: "Container pickup source address line 1",
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  containerPickupAddress1?: string;

  @ApiPropertyOptional({
    description: "Container pickup source address line 2",
  })
  @IsOptional()
  @IsString()
  containerPickupAddress2?: string;

  @ApiPropertyOptional({
    description: "Container pickup source postal code",
  })
  @IsOptional()
  @IsString()
  containerPickupPostal?: string;

  @ApiPropertyOptional({
    description: "Stuffing destination address line 1",
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  stuffingAddress1?: string;

  @ApiPropertyOptional({
    description: "Stuffing destination address line 2",
  })
  @IsOptional()
  @IsString()
  stuffingAddress2?: string;

  @ApiPropertyOptional({
    description: "Stuffing destination postal code",
  })
  @IsOptional()
  @IsString()
  stuffingPostal?: string;

  @ApiPropertyOptional({
    description: "Stuffing destination contact person",
  })
  @IsOptional()
  @IsString()
  stuffingContactName?: string;

  @ApiPropertyOptional({
    description: "Stuffing destination contact phone",
  })
  @IsOptional()
  @IsString()
  stuffingContactPhone?: string;

  @ApiPropertyOptional({
    description: "Container return destination depot code",
  })
  @IsOptional()
  @IsString()
  returnDepotCode?: string;

  @ApiPropertyOptional({
    description: "Container return due date",
  })
  @IsOptional()
  @IsDateString()
  returnLastDay?: string;

  @ApiPropertyOptional({
    description: "Export origin depot code (legacy alias of pickupDepotCode)",
  })
  @IsOptional()
  @IsString()
  exportOriginDepotCode?: string;

  @ApiPropertyOptional({ description: "Singapore export port code (context)" })
  @IsOptional()
  @IsString()
  exportPortCode?: string;

  @ApiPropertyOptional({ description: "Export terminal code (optional context)" })
  @IsOptional()
  @IsString()
  exportTerminalCode?: string;

  @ApiPropertyOptional({ description: "Vessel name for export context" })
  @IsOptional()
  @IsString()
  vesselName?: string;

  @ApiPropertyOptional({ description: "Vessel ETA for export context" })
  @IsOptional()
  @IsDateString()
  vesselEta?: string;
}

export class CreateJobDto {
  @ApiProperty({ enum: JobType })
  @IsEnum(JobType)
  jobType: JobType;

  @ApiPropertyOptional({
    enum: CollectionType,
    description:
      "Required when jobType is COLLECTION (EMPTY or LOADED). Ignored for other job types.",
  })
  @ValidateIf((o) => o.jobType === JobType.COLLECTION)
  @IsNotEmpty({ message: "collectionType is required when jobType is COLLECTION" })
  @IsEnum(CollectionType)
  collectionType?: CollectionType;

  @ApiProperty()
  @IsString()
  customerCompanyId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  pickupDate?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  pickupAddress1: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupAddress2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupPostal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupContactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupContactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupPlaceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  pickupLat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  pickupLng?: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  deliveryAddress1: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryAddress2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryPostal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryPlaceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  deliveryLat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  deliveryLng?: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  receiverName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  receiverPhone: string;

  @ApiPropertyOptional({
    description:
      "Client order reference (external ref). Omit or set to null if not provided.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  externalRef?: string | null;

  @ApiPropertyOptional({
    type: [CreateJobItemDto],
    description:
      "LCL item/qty lines (optional). IMPORT/EXPORT/COLLECTION container lines (optional containerNumber, sealNo, pickupReference).",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJobItemDto)
  items?: CreateJobItemDto[];

  @ApiPropertyOptional({
    type: [CreateJobItemDto],
    description: "Alias for items (same shape). Optional for LCL only.",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJobItemDto)
  cargoItems?: CreateJobItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  notes?: string;

  @ApiPropertyOptional({
    description:
      "Optional legacy job-level container number. Seeds generated trips for IMPORT/EXPORT only.",
  })
  @IsOptional()
  @IsString()
  containerNumber?: string;

  @ApiPropertyOptional({
    type: CreateJobImportDetailsDto,
    description:
      "IMPORT-only nested details. Preferred shape for import routing and vessel fields.",
  })
  @ValidateIf((o) => o.jobType === JobType.IMPORT)
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateJobImportDetailsDto)
  importDetails?: CreateJobImportDetailsDto;

  @ApiPropertyOptional({
    type: CreateJobExportDetailsDto,
    description: "EXPORT-only nested details. Preferred shape for export routing fields.",
  })
  @ValidateIf((o) => o.jobType === JobType.EXPORT)
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateJobExportDetailsDto)
  exportDetails?: CreateJobExportDetailsDto;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer importDetails.pickupPortCode)",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  pickupPortCode?: string;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer importDetails.portTerminalCode)",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  portTerminalCode?: string;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer importDetails.portName)",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  portName?: string;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer importDetails.psaStorageRentLastDay)",
    deprecated: true,
  })
  @IsOptional()
  @IsDateString()
  psaStorageRentLastDay?: string;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer importDetails.vesselName)",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  vesselName?: string;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer importDetails.vesselEta)",
    deprecated: true,
  })
  @IsOptional()
  @IsDateString()
  vesselEta?: string;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer importDetails.portnetReady)",
    deprecated: true,
  })
  @IsOptional()
  @IsBoolean()
  portnetReady?: boolean;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer importDetails.permitReady)",
    deprecated: true,
  })
  @IsOptional()
  @IsBoolean()
  permitReady?: boolean;

  @ApiPropertyOptional({
    description:
      "Legacy flat field (prefer importDetails.returningDepotCode). Optional; omit for single port → delivery IMPORT trip.",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  returningDepotCode?: string;

  @ApiPropertyOptional({
    description:
      "Legacy flat field (prefer importDetails.returnLastDay). Optional metadata only; does not require return depot.",
    deprecated: true,
  })
  @IsOptional()
  @IsDateString()
  returnLastDay?: string;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer exportDetails.pickupDepotCode)",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  exportOriginDepotCode?: string;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer exportDetails.exportPortCode)",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  exportPortCode?: string;

}



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
} from "class-validator";
import { JobType } from "@prisma/client";
import { Type } from "class-transformer";


export class CreateJobItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  itemCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  qty?: number;

}

export class CreateJobImportDetailsDto {
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

  @ApiPropertyOptional({ description: "master_singapore_depots.code" })
  @IsOptional()
  @IsString()
  returningDepotCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  returnLastDay?: string;
}

export class CreateJobExportDetailsDto {
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

  @ApiPropertyOptional({ type: [CreateJobItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJobItemDto)
  items?: CreateJobItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  notes?: string;

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
    description: "Legacy flat field (prefer importDetails.returningDepotCode)",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  returningDepotCode?: string;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer importDetails.returnLastDay)",
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



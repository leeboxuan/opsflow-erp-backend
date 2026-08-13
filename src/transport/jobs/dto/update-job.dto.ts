import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsOptional,
  IsString,
  IsDateString,
  MinLength,
  IsNumber,
  IsBoolean,
  ValidateIf,
} from "class-validator";
import { CollectionType, JobType } from "@prisma/client";
import { Type } from "class-transformer";
import { IsArray, ValidateNested } from "class-validator";

export class UpdateJobItemDto {
  @ApiPropertyOptional({
    description:
      "Existing JobItem id. Include when editing a container so linked photos retain their stable association.",
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  itemCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  containerNumber?: string;

  @ApiPropertyOptional({ description: "Seal number (persisted as sealNo)" })
  @IsOptional()
  @IsString()
  sealNo?: string;

  @ApiPropertyOptional({ description: "API alias for sealNo" })
  @IsOptional()
  @IsString()
  sealNumber?: string;

  @ApiPropertyOptional({
    description:
      "Deprecated for container-style jobs: use job-level pickupReference. Ignored on IMPORT/EXPORT/COLLECTION writes.",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  pickupReference?: string;

  @ApiPropertyOptional({
    description:
      "LCL item description. Ignored on container-style job writes (use job-level description).",
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  qty?: number;
}
  
export class UpdateJobDto {
  @ApiPropertyOptional({ enum: JobType })
  @IsOptional()
  @IsEnum(JobType)
  jobType?: JobType;

  @ApiPropertyOptional({
    enum: CollectionType,
    description: "COLLECTION only (EMPTY or LOADED). Ignored for other job types.",
  })
  @IsOptional()
  @IsEnum(CollectionType)
  collectionType?: CollectionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerCompanyId?: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Accepted CustomerQuotation id for this job, or null to unbind. Must belong to the job's customer.",
  })
  @IsOptional()
  @ValidateIf((_, value) => value != null && value !== "")
  @IsString()
  sourceCustomerQuotationId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  pickupDate?: string;

  @ApiPropertyOptional({
    description: "Job-level pickup reference",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  pickupReference?: string | null;

  @ApiPropertyOptional({
    description: "Job-level description (distinct from LCL item descriptions)",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    description: "Carrier name (all job types)",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  carrierName?: string | null;

  @ApiPropertyOptional({
    description: "Voyage (all job types)",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  voyage?: string | null;

  @ApiPropertyOptional({
    description: "Shipper (all job types)",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  shipper?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  pickupAddress1?: string;

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
  @MinLength(1)
  deliveryAddress1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryAddress2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryPostal?: string;

  @ApiPropertyOptional({
    description:
      "Delivery contact name. Optional for IMPORT, EXPORT, COLLECTION, and LCL.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  receiverName?: string | null;

  @ApiPropertyOptional({
    description:
      "Delivery contact phone. Optional for IMPORT, EXPORT, COLLECTION, and LCL.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  receiverPhone?: string | null;

  @ApiPropertyOptional({
    description:
      "Client order reference (external ref). Omit to leave unchanged, set to null to clear.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  externalRef?: string | null;

  @ApiPropertyOptional({
    type: [UpdateJobItemDto],
    description:
      "Replace all cargo lines when sent. Omit to leave unchanged. LCL may use [] to clear lines; Import/Export require at least one valid line.",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateJobItemDto)
  items?: UpdateJobItemDto[];

  @ApiPropertyOptional({
    type: [UpdateJobItemDto],
    description: "Alias for items on PATCH (same rules).",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateJobItemDto)
  cargoItems?: UpdateJobItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  notes?: string;

  @ApiPropertyOptional()
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
      "Optional IMPORT return depot code. Null/omit for jobs with no return location (one port → delivery trip).",
  })
  @IsOptional()
  @IsString()
  returningDepotCode?: string;

  @ApiPropertyOptional({
    description: "Optional container return due date. Does not require return depot.",
  })
  @IsOptional()
  @IsDateString()
  returnLastDay?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  exportOriginDepotCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  exportPortCode?: string;
}

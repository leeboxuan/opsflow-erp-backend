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
import {
  CreateJobExportDetailsDto,
  CreateJobImportDetailsDto,
} from "./create-job.dto";

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
  itemCode?: string | null;

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

  @ApiPropertyOptional({
    enum: ["20ft", "40ft", "45ft"],
    description:
      "Container size for IMPORT/EXPORT/COLLECTION. Required when intentionally editing a container row.",
  })
  @IsOptional()
  @IsString()
  containerSize?: string | null;
}
  
export class UpdateJobDto {
  @ApiPropertyOptional({
    enum: JobType,
    isArray: true,
    description: "Replace canonical job types (Phase 4). At least one required when provided.",
  })
  @IsOptional()
  @IsArray()
  @IsEnum(JobType, { each: true })
  jobTypes?: JobType[];

  @ApiPropertyOptional({
    enum: JobType,
    description: "Legacy singular type update; prefer jobTypes.",
  })
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
    nullable: true,
    description:
      "Requested pickup time precision. true = explicit time; false = date-only; null clears with pickupDate.",
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsBoolean()
  pickupDateHasTime?: boolean | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Requested delivery time precision. true = explicit time; false = date-only; null clears with deliveryDate.",
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsBoolean()
  deliveryDateHasTime?: boolean | null;

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

  @ApiPropertyOptional({
    type: CreateJobImportDetailsDto,
    description:
      "IMPORT nested details. Partial merge: omitted nested keys are left unchanged; null clears nullable fields; false sets booleans.",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateJobImportDetailsDto)
  importDetails?: CreateJobImportDetailsDto;

  @ApiPropertyOptional({
    type: CreateJobExportDetailsDto,
    description:
      "EXPORT nested details. Partial merge: omitted nested keys are left unchanged; null clears nullable fields.",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateJobExportDetailsDto)
  exportDetails?: CreateJobExportDetailsDto;

  @ApiPropertyOptional({
    description: "Legacy flat field (prefer importDetails.pickupPortCode)",
    nullable: true,
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  pickupPortCode?: string | null;

  @ApiPropertyOptional({ nullable: true, deprecated: true })
  @IsOptional()
  @IsString()
  portTerminalCode?: string | null;

  @ApiPropertyOptional({ nullable: true, deprecated: true })
  @IsOptional()
  @IsString()
  portName?: string | null;

  @ApiPropertyOptional({ nullable: true, deprecated: true })
  @IsOptional()
  @IsDateString()
  psaStorageRentLastDay?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  vesselName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  vesselEta?: string | null;

  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsBoolean()
  portnetReady?: boolean;

  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsBoolean()
  permitReady?: boolean;

  @ApiPropertyOptional({
    description:
      "RETURN intake: mark return depot as not confirmed yet. Null/false clears; omit to leave unchanged.",
    nullable: true,
  })
  @IsOptional()
  @IsBoolean()
  returningDepotPending?: boolean | null;

  @ApiPropertyOptional({
    description:
      "Preserved TBA/source wording while depot is pending. Null clears; omit to leave unchanged.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  returningDepotPendingText?: string | null;

  @ApiPropertyOptional({
    description:
      "Optional IMPORT return depot code. Null clears; omit to leave unchanged.",
    nullable: true,
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  returningDepotCode?: string | null;

  @ApiPropertyOptional({
    description: "Optional container return due date. Null clears; omit to leave unchanged.",
    nullable: true,
    deprecated: true,
  })
  @IsOptional()
  @IsDateString()
  returnLastDay?: string | null;

  @ApiPropertyOptional({ nullable: true, deprecated: true })
  @IsOptional()
  @IsString()
  exportOriginDepotCode?: string | null;

  @ApiPropertyOptional({ nullable: true, deprecated: true })
  @IsOptional()
  @IsString()
  exportPortCode?: string | null;
}

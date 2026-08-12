import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import {
  JobMessageImportDraftInclusionState,
  JobMessageImportMovementType,
} from "@prisma/client";

export class JobMessageImportDraftItemDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  containerNumber?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  sealNumber?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  referenceNumber?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  quantity?: number | null;
}

export class JobMessageImportPatchDraftDto {
  @ApiProperty({ description: "Expected draft optimistic concurrency version" })
  @IsInt()
  expectedDraftVersion!: number;

  @ApiProperty({ required: false, enum: JobMessageImportMovementType })
  @IsOptional()
  @IsIn(["COLLECTION", "IMPORT", "EXPORT", "LCL", "UNKNOWN"])
  movementType?: JobMessageImportMovementType;

  @ApiProperty({ required: false, nullable: true, enum: ["EMPTY", "LOADED"] })
  @IsOptional()
  @IsIn(["EMPTY", "LOADED"])
  collectionType?: "EMPTY" | "LOADED" | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  customerCompanyId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  customerNameText?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  pickupAddress1?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  pickupAddress2?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  pickupPostal?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  pickupPlaceId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  pickupLat?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  pickupLng?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  deliveryAddress1?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  deliveryAddress2?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  deliveryPostal?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  deliveryPlaceId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  deliveryLat?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  deliveryLng?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  pickupDateLocal?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  deliveryDateLocal?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  pickupDateDisplay?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  deliveryDateDisplay?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  pickupDateNeedsReview?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  deliveryDateNeedsReview?: boolean;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  picName?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  picPhone?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  instructions?: string[];

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  timingText?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  carrierName?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  shipper?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  vesselName?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  voyage?: string | null;

  @ApiProperty({ required: false, type: [JobMessageImportDraftItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JobMessageImportDraftItemDto)
  items?: JobMessageImportDraftItemDto[];

  @ApiProperty({ required: false, enum: ["INCLUDED", "EXCLUDED"] })
  @IsOptional()
  @IsIn([
    JobMessageImportDraftInclusionState.INCLUDED,
    JobMessageImportDraftInclusionState.EXCLUDED,
  ])
  inclusionState?: JobMessageImportDraftInclusionState;

  @ApiProperty({
    required: false,
    description: "Explicit acknowledgement that possible duplicate candidates are not the same job.",
  })
  @IsOptional()
  @IsBoolean()
  duplicateOverrideAcknowledged?: boolean;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  duplicateOverrideReason?: string | null;
}

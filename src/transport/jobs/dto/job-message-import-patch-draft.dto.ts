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
  @IsIn(["COLLECTION", "IMPORT", "EXPORT", "LCL", "RETURN", "ONE_WAY", "UNKNOWN"])
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
  portAddress1?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  portAddress2?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  portPostal?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  portPlaceId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  portLat?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  portLng?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  returningDepotAddress1?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  returningDepotAddress2?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  returningDepotPostal?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  returningDepotPlaceId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  returningDepotLat?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  returningDepotLng?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  returningDepotCode?: string | null;

  @ApiProperty({
    required: false,
    description:
      "RETURN intake: acknowledge depot not confirmed yet. Allows confirm into Draft without a resolved depot.",
  })
  @IsOptional()
  @IsBoolean()
  returningDepotPending?: boolean;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  returningDepotPendingText?: string | null;

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

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  containerSizeType?: string | null;

  @ApiProperty({ required: false, type: [Object] })
  @IsOptional()
  @IsArray()
  autoTripDocumentRequirements?: Array<{
    tripIndex?: number;
    signedDeliveryDoRequired?: boolean;
    signedLorryChitRequired?: boolean;
  }>;

  @ApiProperty({
    required: false,
    nullable: true,
    description: "Job-level pickup reference (not container / booking / permit identity).",
  })
  @IsOptional()
  @IsString()
  pickupReference?: string | null;

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

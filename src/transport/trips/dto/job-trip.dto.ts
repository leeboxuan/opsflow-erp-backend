import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsBoolean,
  IsOptional,
  IsArray,
  ValidateNested,
  IsString,
  Min,
  Max,
  MinLength,
  IsNumber,
} from "class-validator";
import { CollectionType, JobTripTemplate } from "@prisma/client";
import { Transform, Type } from "class-transformer";
import { UpdateJobItemDto } from "../../jobs/dto/update-job.dto";

export enum JobTripOrderStrategy {
  DISTANCE = "DISTANCE",
  TIME = "TIME",
}

export class JobTripSuggestStartLocationDto {
  @ApiProperty()
  @IsNumber()
  lat!: number;

  @ApiProperty()
  @IsNumber()
  lng!: number;
}

export class SuggestJobTripOrderDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tripIds?: string[];

  @ApiPropertyOptional({ type: () => JobTripSuggestStartLocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => JobTripSuggestStartLocationDto)
  startLocation?: JobTripSuggestStartLocationDto;

  @ApiPropertyOptional({
    description:
      "When true and startLocation is omitted, attempt to use assigned driver's latest GPS as suggestion start point.",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  useDriverLatestLocation?: boolean;

  @ApiPropertyOptional({ enum: JobTripOrderStrategy, default: JobTripOrderStrategy.DISTANCE })
  @IsOptional()
  @IsEnum(JobTripOrderStrategy)
  strategy?: JobTripOrderStrategy;
}

export class PublishJobTripRouteDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tripIdsInOrder?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  publishTripIds?: string[];
}

export class AppendJobTripDto {
  @ApiPropertyOptional({
    enum: JobTripTemplate,
    description: "Optional. Empty/null defaults to CUSTOM in service",
  })
  @IsOptional()
  @Transform(({ value }) => (value === "" ? undefined : value))
  @IsEnum(JobTripTemplate)
  jobTripTemplate?: JobTripTemplate | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional({ description: "Planned trip start (ISO datetime)" })
  @IsOptional()
  @IsDateString()
  plannedStartAt?: string | null;

  @ApiPropertyOptional({ description: "Planned start (YYYY-MM-DD)" })
  @IsOptional()
  @IsDateString()
  plannedDate?: string;

  @ApiPropertyOptional({
    description: "Legacy origin label fallback when originAddress1 is omitted",
  })
  @IsOptional()
  @IsString()
  originSummary?: string | null;

  @ApiPropertyOptional({
    description: "Legacy destination label fallback when destinationAddress1 is omitted",
  })
  @IsOptional()
  @IsString()
  destinationSummary?: string | null;

  @ApiPropertyOptional({ description: "Structured origin address line 1" })
  @IsOptional()
  @IsString()
  originAddress1?: string | null;

  @ApiPropertyOptional({ description: "Structured origin unit / address line 2" })
  @IsOptional()
  @IsString()
  originAddress2?: string | null;

  @ApiPropertyOptional({ description: "Structured destination address line 1" })
  @IsOptional()
  @IsString()
  destinationAddress1?: string | null;

  @ApiPropertyOptional({
    description: "Structured destination unit / address line 2",
  })
  @IsOptional()
  @IsString()
  destinationAddress2?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  originPostalCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  destinationPostalCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  originPlaceId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  destinationPlaceId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  originLat?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  originLng?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  destinationLat?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  destinationLng?: number | null;

  @ApiPropertyOptional({
    description: "Trip-specific ops/driver instructions stored on Trip.notes",
  })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tripPICName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tripPICContact?: string | null;

  @ApiPropertyOptional({
    description:
      "Optional. Primary for IMPORT/EXPORT; LCL is item-based—UI may omit. Never required. Legacy/display cache only — TripJobItem is SoT.",
  })
  @IsOptional()
  @IsString()
  containerNumber?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      "Explicit JobItem ids to link via TripJobItem on append. Optional; single-item jobs auto-link. Multi-item jobs require links before publish.",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  jobItemIds?: string[];

  @ApiPropertyOptional({
    description: "Optional shipping ref; primary for IMPORT/EXPORT. Not required for LCL.",
  })
  @IsOptional()
  @IsString()
  carrier?: string | null;

  @ApiPropertyOptional({
    description: "Optional shipping ref; primary for IMPORT/EXPORT. Not required for LCL.",
  })
  @IsOptional()
  @IsString()
  shipper?: string | null;

  @ApiPropertyOptional({
    description: "Optional shipping ref; primary for IMPORT/EXPORT. Not required for LCL.",
  })
  @IsOptional()
  @IsString()
  vessel?: string | null;

  @ApiPropertyOptional({
    description:
      "Optional payout master item id. Validated against active DRIVER_PAYOUT master.",
  })
  @IsOptional()
  @IsString()
  earningRateMasterId?: string | null;

  @ApiPropertyOptional({
    description:
      "Optional payout lines to save immediately after trip creation using existing payout draft logic.",
  })
  @IsOptional()
  @IsArray()
  payoutLines?: Array<Record<string, unknown>>;
}

export class ReorderJobTripsDto {
  @ApiProperty({
    type: [String],
    description: "Trip ids in desired sequence (all trips for the job)",
  })
  @IsString({ each: true })
  @IsOptional()
  tripIdsInOrder?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: "Trip ids in desired sequence (alias for tripIdsInOrder)",
  })
  @IsOptional()
  @IsString({ each: true })
  tripIds?: string[];
}

export class AssignJobTripDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  driverId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vehicleType?: string;
}

export class TripLocationPatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine1?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine2?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  postalCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lat?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lng?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  placeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationId?: string | null;
}

/** Flat operational fields for PATCH /api/jobs/:jobId/trips/:tripId/details */
export class PatchTripDetailsDto {
  @ApiPropertyOptional({ description: "Planned trip start (ISO datetime)" })
  @IsOptional()
  @IsDateString()
  plannedStartAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
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
  pickupPlaceId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  pickupLat?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  pickupLng?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupContactName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupContactPhone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryAddress1?: string;

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
  deliveryPlaceId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  deliveryLat?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  deliveryLng?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiverName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiverPhone?: string;

  @ApiPropertyOptional({
    description: "Trip-specific ops/driver instructions stored on Trip.notes",
  })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional({ description: "Job-level driver instruction (mobile)" })
  @IsOptional()
  @IsString()
  jobNotes?: string | null;

  @ApiPropertyOptional({ description: "Alias for job-level notes shown to driver" })
  @IsOptional()
  @IsString()
  tripInstruction?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tripPICName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tripPICContact?: string | null;

  @ApiPropertyOptional({ enum: CollectionType })
  @IsOptional()
  @IsEnum(CollectionType)
  collectionType?: CollectionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vesselName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  vesselEta?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  returningDepotCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  returnLastDay?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupPortCode?: string | null;

  @ApiPropertyOptional({ type: [UpdateJobItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateJobItemDto)
  items?: UpdateJobItemDto[];

  @ApiPropertyOptional({ type: [UpdateJobItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateJobItemDto)
  cargoItems?: UpdateJobItemDto[];

  @ApiPropertyOptional({
    description:
      "When true with items[], omitted existing JobItems are deleted (freeze-guarded). " +
      "When false/omitted, items with stable ids are patched in place and siblings are preserved.",
  })
  @IsOptional()
  @IsBoolean()
  replaceItems?: boolean;
}

export class PatchJobTripDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  jobSequence?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  displayTitle?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedStartAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedDate?: string;

  @ApiPropertyOptional({ type: () => TripLocationPatchDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TripLocationPatchDto)
  origin?: TripLocationPatchDto | null;

  @ApiPropertyOptional({ type: () => TripLocationPatchDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TripLocationPatchDto)
  destination?: TripLocationPatchDto | null;

  @ApiPropertyOptional({
    description: "Assign driver trip rate master; snapshots earning on trip",
  })
  @IsOptional()
  @IsString()
  earningRateMasterId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  originLocationId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  destinationLocationId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  originSummary?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  destinationSummary?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trailerNumber?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trailerLastLocationCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tripPICName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tripPICContact?: string | null;

  @ApiPropertyOptional({
    description:
      "Optional. Primary for IMPORT/EXPORT; LCL is item-based—UI may omit. Never required. Legacy/display cache only — TripJobItem is SoT.",
  })
  @IsOptional()
  @IsString()
  containerNumber?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      "When provided, replaces TripJobItem links for this trip (hard-delete + recreate). Frozen on COMPLETED/DONE.",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  jobItemIds?: string[];

  @ApiPropertyOptional({
    description: "Optional shipping ref; primary for IMPORT/EXPORT. Not required for LCL.",
  })
  @IsOptional()
  @IsString()
  carrier?: string | null;

  @ApiPropertyOptional({
    description: "Optional shipping ref; primary for IMPORT/EXPORT. Not required for LCL.",
  })
  @IsOptional()
  @IsString()
  shipper?: string | null;

  @ApiPropertyOptional({
    description: "Optional shipping ref; primary for IMPORT/EXPORT. Not required for LCL.",
  })
  @IsOptional()
  @IsString()
  vessel?: string | null;
}

export class TripPayoutLineInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  earningRateMasterId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payoutItemId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceRateMasterItemId?: string | null;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  code?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  amountCents?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  totalCents?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isManual?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresManualAmount?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isSelectableForTripEarning?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class PutTripPayoutLinesDto {
  @ApiProperty({ type: [TripPayoutLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TripPayoutLineInputDto)
  lines!: TripPayoutLineInputDto[];
}

export class PatchTripPayoutDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  earningRateMasterId?: string | null;

  @ApiProperty({ type: [TripPayoutLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TripPayoutLineInputDto)
  payoutLines!: TripPayoutLineInputDto[];
}

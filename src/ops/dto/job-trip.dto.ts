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
import { JobTripTemplate } from "@prisma/client";
import { Transform, Type } from "class-transformer";

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

  @ApiPropertyOptional()
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

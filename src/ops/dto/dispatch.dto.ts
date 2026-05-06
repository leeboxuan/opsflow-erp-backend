import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class DispatchReorderTripsDto {
  @ApiProperty({ example: "2026-04-30" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  tripIdsInOrder!: string[];
}

export class DispatchStartLocationDto {
  @ApiProperty()
  @IsNumber()
  lat!: number;

  @ApiProperty()
  @IsNumber()
  lng!: number;
}

export enum DispatchOptimiseStrategy {
  DISTANCE = "DISTANCE",
  TIME = "TIME",
}

export enum DispatchRouteMode {
  DRIVE = "DRIVE",
}

export class DispatchOptimiseRouteDto {
  @ApiProperty({ example: "2026-04-30" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiProperty({ enum: DispatchOptimiseStrategy })
  @IsEnum(DispatchOptimiseStrategy)
  strategy!: DispatchOptimiseStrategy;

  @ApiPropertyOptional({ type: () => DispatchStartLocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DispatchStartLocationDto)
  startLocation?: DispatchStartLocationDto;
}

export class DispatchRouteQueryDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  fromLat!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  fromLng!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  toLat!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  toLng!: number;

  @ApiPropertyOptional({ enum: DispatchRouteMode, default: DispatchRouteMode.DRIVE })
  @IsOptional()
  @IsEnum(DispatchRouteMode)
  mode?: DispatchRouteMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tripId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cacheKey?: string;
}

export class DispatchRouteResponseDto {
  @ApiProperty({ example: "GOOGLE_ROUTES" })
  provider!: "GOOGLE_ROUTES";

  @ApiPropertyOptional()
  polyline!: string | null;

  @ApiProperty({ example: "ENCODED_POLYLINE" })
  polylineEncoding!: "ENCODED_POLYLINE";

  @ApiPropertyOptional()
  distanceMeters!: number | null;

  @ApiPropertyOptional()
  durationSeconds!: number | null;

  @ApiPropertyOptional()
  staticDurationSeconds?: number | null;

  @ApiPropertyOptional({ type: [String] })
  routeLabels?: string[];

  @ApiProperty()
  cached!: boolean;

  @ApiPropertyOptional()
  error?: string | null;
}

/** Trailer checkout photo metadata (URLs only; no storage keys). */
export class DispatchBoardTrailerPhotoDto {
  @ApiPropertyOptional()
  fileUrl!: string | null;

  @ApiPropertyOptional()
  fileName!: string;

  @ApiPropertyOptional()
  originalFileName!: string | null;

  @ApiPropertyOptional()
  mimeType!: string | null;

  @ApiPropertyOptional()
  fileSizeBytes!: number | null;
}

export class DispatchBoardTripDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  jobId!: string | null;

  @ApiPropertyOptional()
  jobInternalRef!: string | null;

  @ApiPropertyOptional()
  tripDisplayRef!: string | null;

  @ApiPropertyOptional()
  jobRef!: string | null;

  @ApiPropertyOptional()
  customerName!: string | null;

  @ApiPropertyOptional()
  title!: string | null;

  @ApiPropertyOptional()
  tripPICName!: string | null;

  @ApiPropertyOptional()
  tripPICContact!: string | null;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional()
  plannedStartAt!: Date | null;

  @ApiPropertyOptional()
  jobSequence!: number | null;

  @ApiPropertyOptional()
  tripSequence!: number | null;

  @ApiPropertyOptional()
  origin!: string | null;

  @ApiPropertyOptional()
  destination!: string | null;

  @ApiPropertyOptional()
  originLat!: number | null;

  @ApiPropertyOptional()
  originLng!: number | null;

  @ApiPropertyOptional()
  destinationLat!: number | null;

  @ApiPropertyOptional()
  destinationLng!: number | null;

  @ApiPropertyOptional()
  publishedAt!: Date | null;

  @ApiPropertyOptional()
  startedAt!: Date | null;

  @ApiPropertyOptional()
  closedAt!: Date | null;

  @ApiPropertyOptional()
  trailerNumber!: string | null;

  @ApiPropertyOptional()
  trailerLastLocationCode!: string | null;

  @ApiPropertyOptional()
  trailerParkedAt!: Date | null;

  @ApiPropertyOptional()
  trailerParkingLat!: number | null;

  @ApiPropertyOptional()
  trailerParkingLng!: number | null;

  @ApiPropertyOptional()
  trailerLastLocationName!: string | null;

  @ApiPropertyOptional()
  trailerStartPhotoUrl!: string | null;

  @ApiPropertyOptional()
  trailerEndPhotoUrl!: string | null;

  @ApiPropertyOptional({ type: () => DispatchBoardTrailerPhotoDto })
  trailerStartPhoto!: DispatchBoardTrailerPhotoDto | null;

  @ApiPropertyOptional({ type: () => DispatchBoardTrailerPhotoDto })
  trailerEndPhoto!: DispatchBoardTrailerPhotoDto | null;
}

export class DispatchBoardLocationDto {
  @ApiProperty()
  lat!: number;

  @ApiProperty()
  lng!: number;

  @ApiPropertyOptional()
  accuracy!: number | null;

  @ApiPropertyOptional()
  heading!: number | null;

  @ApiPropertyOptional()
  speed!: number | null;

  @ApiProperty()
  capturedAt!: Date;

  @ApiPropertyOptional()
  recordedAt!: Date | null;

  @ApiPropertyOptional()
  updatedAt!: Date | null;

  @ApiPropertyOptional()
  lastMovedAt!: Date | null;
}

export enum DispatchGpsStatus {
  LIVE = "LIVE",
  IDLE = "IDLE",
  STALE = "STALE",
  NO_GPS = "NO_GPS",
}

export class DispatchBoardDriverDto {
  @ApiProperty()
  driverUserId!: string;

  @ApiPropertyOptional()
  driverId!: string | null;

  @ApiPropertyOptional()
  driverName!: string | null;

  @ApiPropertyOptional()
  phone!: string | null;

  @ApiPropertyOptional()
  driverPhone!: string | null;

  @ApiPropertyOptional()
  vehicle!: string | null;

  @ApiPropertyOptional()
  vehicleNumber!: string | null;

  @ApiPropertyOptional({ type: () => DispatchBoardLocationDto })
  latestLocation!: DispatchBoardLocationDto | null;

  @ApiPropertyOptional()
  lastGpsAgeMinutes!: number | null;

  @ApiPropertyOptional()
  stationaryMinutes!: number | null;

  @ApiProperty({ enum: DispatchGpsStatus })
  gpsStatus!: DispatchGpsStatus;

  @ApiPropertyOptional({ type: () => DispatchBoardTripDto })
  activeTrip!: DispatchBoardTripDto | null;

  @ApiProperty({ type: () => [DispatchBoardTripDto] })
  todayTrips!: DispatchBoardTripDto[];

  @ApiProperty({ type: () => [DispatchBoardTripDto] })
  trips!: DispatchBoardTripDto[];
}

export class DispatchBoardResponseDto {
  @ApiProperty()
  generatedAt!: string;

  @ApiProperty()
  date!: string;

  @ApiProperty({ type: () => [DispatchBoardDriverDto] })
  drivers!: DispatchBoardDriverDto[];

  @ApiProperty({ type: () => [DispatchBoardTripDto] })
  unassignedTrips!: DispatchBoardTripDto[];

  @ApiProperty({ type: () => [DispatchBoardTripDto] })
  ongoingTrips!: DispatchBoardTripDto[];
}

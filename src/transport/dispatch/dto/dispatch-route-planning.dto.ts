import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from "class-validator";

export class DispatchPlanStartLocationDto {
  @ApiProperty()
  @IsNumber()
  lat!: number;

  @ApiProperty()
  @IsNumber()
  lng!: number;
}

export class DispatchPlanSuggestDto {
  @ApiProperty({ example: "2026-08-20" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiProperty({ description: "Driver lane to suggest sequence for" })
  @IsString()
  driverUserId!: string;

  @ApiPropertyOptional({ type: () => DispatchPlanStartLocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DispatchPlanStartLocationDto)
  startLocation?: DispatchPlanStartLocationDto;
}

export class DispatchPlanTripVersionDto {
  @ApiProperty()
  @IsString()
  tripId!: string;

  @ApiProperty({ description: "Expected Trip.dispatchVersion (not routeVersion)" })
  @IsInt()
  @Min(0)
  dispatchVersion!: number;
}

export class DispatchPlanAssignmentDto {
  @ApiProperty()
  @IsString()
  tripId!: string;

  @ApiProperty({ description: "Target driver user id" })
  @IsString()
  driverUserId!: string;
}

export class DispatchPlanSaveDto {
  @ApiProperty({ example: "2026-08-20" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiProperty()
  @IsString()
  driverUserId!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  tripIdsInOrder!: string[];

  @ApiPropertyOptional({
    description:
      "Optimistic concurrency token = sum of dispatchVersion for the lane trips after assignments",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedPlanVersion?: number;

  @ApiPropertyOptional({ type: () => [DispatchPlanTripVersionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DispatchPlanTripVersionDto)
  expectedTripVersions?: DispatchPlanTripVersionDto[];

  @ApiPropertyOptional({
    type: () => [DispatchPlanAssignmentDto],
    description: "Optional assign/reassign applied atomically with sequencing",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DispatchPlanAssignmentDto)
  assignments?: DispatchPlanAssignmentDto[];
}

export class DispatchPlanPublishDto {
  @ApiPropertyOptional({ example: "2026-08-20" })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  tripIds!: string[];
}

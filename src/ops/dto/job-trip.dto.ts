import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from "class-validator";
import { JobTripTemplate } from "@prisma/client";

export class AppendJobTripDto {
  @ApiProperty({ enum: JobTripTemplate })
  @IsEnum(JobTripTemplate)
  jobTripTemplate!: JobTripTemplate;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional({ description: "Planned start (YYYY-MM-DD)" })
  @IsOptional()
  @IsDateString()
  plannedDate?: string;
}

export class ReorderJobTripsDto {
  @ApiProperty({
    type: [String],
    description: "Trip ids in desired sequence (all trips for the job)",
  })
  @IsString({ each: true })
  tripIdsInOrder!: string[];
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
  @IsDateString()
  plannedDate?: string;

  @ApiPropertyOptional({
    description: "Assign driver trip rate master; snapshots earning on trip",
  })
  @IsOptional()
  @IsString()
  earningRateMasterId?: string | null;
}

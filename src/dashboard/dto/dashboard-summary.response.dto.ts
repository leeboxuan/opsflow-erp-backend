import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";

export class DashboardCompletionRateBasisDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  completed!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  scheduled!: number;
}

export class DashboardKpisDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  jobsInPeriod!: number;

  @ApiProperty({
    minimum: 0,
    description: "Snapshot of PUBLISHED/ONGOING job-linked trips.",
  })
  @IsInt()
  @Min(0)
  tripsInProgress!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  tripsCompletedInPeriod!: number;

  @ApiProperty({
    minimum: 0,
    description:
      "Snapshot of open job-linked trips with no assignedDriverUserId and no driverId.",
  })
  @IsInt()
  @Min(0)
  pendingDriverAssignment!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  readyToInvoiceNotInvoiced!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: "completed/scheduled for the scheduled cohort; null when scheduled is 0.",
  })
  @IsOptional()
  @IsNumber()
  completionRate!: number | null;

  @ApiProperty({ type: DashboardCompletionRateBasisDto })
  @ValidateNested()
  @Type(() => DashboardCompletionRateBasisDto)
  completionRateBasis!: DashboardCompletionRateBasisDto;
}

/**
 * Additive dashboard summary fields for Phase 1.
 * Legacy fields remain on the service response and are not duplicated here.
 */
export class DashboardSummaryMetaDto {
  @ApiProperty({ description: "IANA tenant timezone used for date boundaries." })
  @IsString()
  timeZone!: string;

  @ApiProperty({ example: "2026-08-11" })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: "2026-08-11" })
  @IsDateString()
  to!: string;

  @ApiProperty({ description: "ISO timestamp when the summary was generated." })
  @IsString()
  generatedAt!: string;

  @ApiProperty({ type: DashboardKpisDto })
  @ValidateNested()
  @Type(() => DashboardKpisDto)
  kpis!: DashboardKpisDto;
}

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import {
  DASHBOARD_ATTENTION_TYPES,
  type DashboardAttentionType,
} from "../dashboard-attention";

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

export class DashboardAttentionCountsDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  critical!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  warning!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  info!: number;
}

export class DashboardAttentionItemDto {
  @ApiProperty({ example: "unassigned_starting_soon:trip_01" })
  @IsString()
  id!: string;

  @ApiProperty({ enum: DASHBOARD_ATTENTION_TYPES })
  @IsIn(DASHBOARD_ATTENTION_TYPES)
  type!: DashboardAttentionType;

  @ApiProperty({ enum: ["critical", "warning", "info"] })
  @IsIn(["critical", "warning", "info"])
  severity!: "critical" | "warning" | "info";

  @ApiProperty({ enum: ["TRIP", "JOB"] })
  @IsIn(["TRIP", "JOB"])
  entityType!: "TRIP" | "JOB";

  @ApiProperty()
  @IsString()
  entityId!: string;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty()
  @IsString()
  reason!: string;

  @ApiProperty({ description: "ISO timestamp" })
  @IsString()
  occurredAt!: string;

  @ApiPropertyOptional({ nullable: true, description: "ISO timestamp or null" })
  @IsOptional()
  @IsString()
  dueAt!: string | null;

  @ApiProperty()
  @IsString()
  href!: string;
}

export class DashboardAttentionDto {
  @ApiProperty({
    minimum: 0,
    description: "Exact total matching exceptions across all attention types.",
  })
  @IsInt()
  @Min(0)
  total!: number;

  @ApiProperty({ type: DashboardAttentionCountsDto })
  @ValidateNested()
  @Type(() => DashboardAttentionCountsDto)
  counts!: DashboardAttentionCountsDto;

  @ApiProperty({ type: [DashboardAttentionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DashboardAttentionItemDto)
  items!: DashboardAttentionItemDto[];
}

/**
 * Additive dashboard summary fields for Phase 1/2.
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

  @ApiProperty({ type: DashboardAttentionDto })
  @ValidateNested()
  @Type(() => DashboardAttentionDto)
  attention!: DashboardAttentionDto;
}

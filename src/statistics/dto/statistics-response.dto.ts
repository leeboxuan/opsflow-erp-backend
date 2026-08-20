import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import {
  STATISTICS_EXCEPTION_KEYS,
  STATISTICS_EXCEPTION_SEVERITIES,
  StatisticsExceptionKey,
  StatisticsExceptionSeverity,
} from "../statistics.constants";

export class StatisticsCurrencyAmountDto {
  @ApiProperty({ example: "SGD" })
  @IsString()
  currency!: string;

  @ApiProperty({ description: "Integer minor units (cents)." })
  @IsInt()
  amountCents!: number;
}

export class StatisticsPaginationMetaDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  total!: number;
}

export abstract class StatisticsResponseBaseDto {
  @ApiProperty({ description: "IANA tenant timezone used for date boundaries." })
  @IsString()
  timeZone!: string;

  @ApiProperty({ type: Date })
  @Type(() => Date)
  @IsDate()
  generatedAt!: Date;

  @ApiProperty({
    type: [String],
    description:
      "Visible data-quality or mutability limitations that apply to this response.",
  })
  @IsArray()
  @IsString({ each: true })
  limitations: string[] = [];
}

export class StatisticsOverviewDto extends StatisticsResponseBaseDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  completedTrips!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  operationallyCompletedJobs!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  activePendingTrips!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  cancelledTrips!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  uniqueContainers!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  containerMovements!: number;
}

export class StatisticsDriverRowDto {
  @ApiProperty()
  @IsString()
  driverUserId!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  driverName!: string | null;

  @ApiProperty()
  @IsInt()
  @Min(0)
  completedTrips!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  completedJobs!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  uniqueContainers!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  containerMovements!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  activeDays!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  avgTripsPerActiveDay!: number | null;

  @ApiProperty()
  @IsInt()
  @Min(0)
  totalValidDurationMs!: number;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  avgDurationMs!: number | null;

  @ApiProperty()
  @IsInt()
  @Min(0)
  cancelledTrips!: number;

  @ApiProperty({
    description:
      "Count from partial AuditLog history (TRIP_DRIVER_REASSIGNED only).",
  })
  @IsInt()
  @Min(0)
  reassignmentCount!: number;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    maximum: 10_000,
    description: "Required-document completion rate in basis points.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  requiredDocumentCompletionRateBasisPoints!: number | null;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  limitations: string[] = [];
}

export class StatisticsDriversDto extends StatisticsResponseBaseDto {
  @ApiProperty({ type: [StatisticsDriverRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatisticsDriverRowDto)
  data: StatisticsDriverRowDto[] = [];

  @ApiProperty({ type: StatisticsPaginationMetaDto })
  @ValidateNested()
  @Type(() => StatisticsPaginationMetaDto)
  meta!: StatisticsPaginationMetaDto;
}

export class StatisticsFinanceCurrencyGroupDto {
  @ApiProperty()
  @IsString()
  currency!: string;

  @ApiProperty()
  @IsInt()
  jobChargesCents!: number;

  @ApiProperty()
  @IsInt()
  issuedInvoiceValueCents!: number;

  @ApiProperty()
  @IsInt()
  paidInvoiceValueCents!: number;

  @ApiProperty()
  @IsInt()
  uninvoicedReadyValueCents!: number;

  @ApiProperty()
  @IsInt()
  recordedTripPayoutCents!: number;

  @ApiProperty()
  @IsInt()
  attributableJobPayoutCents!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: "Null when the currency group is not profit-eligible.",
  })
  @IsOptional()
  @IsInt()
  grossProfitCents!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "Integer basis points; null when profit is not eligible.",
  })
  @IsOptional()
  @IsInt()
  grossMarginBasisPoints!: number | null;
}

export class StatisticsFinanceExceptionCountsDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  completedJobsMissingCharges!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  completedTripsMissingPayouts!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  excludedFromProfit!: number;
}

export class StatisticsFinanceDto extends StatisticsResponseBaseDto {
  @ApiProperty({ type: [StatisticsFinanceCurrencyGroupDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatisticsFinanceCurrencyGroupDto)
  currencyGroups: StatisticsFinanceCurrencyGroupDto[] = [];

  @ApiProperty({ type: StatisticsFinanceExceptionCountsDto })
  @ValidateNested()
  @Type(() => StatisticsFinanceExceptionCountsDto)
  exceptionCounts!: StatisticsFinanceExceptionCountsDto;

  @ApiProperty({
    description:
      "Jobs in scope where totalCostCents exceeds recognized invoice revenue (canonical JobFinanceSummary).",
  })
  @IsInt()
  @Min(0)
  negativeJobCount!: number;
}

export class StatisticsExceptionItemDto {
  @ApiProperty({ enum: STATISTICS_EXCEPTION_KEYS })
  @IsIn(STATISTICS_EXCEPTION_KEYS)
  key!: StatisticsExceptionKey;

  @ApiProperty({ enum: STATISTICS_EXCEPTION_SEVERITIES })
  @IsIn(STATISTICS_EXCEPTION_SEVERITIES)
  severity!: StatisticsExceptionSeverity;

  @ApiProperty({
    enum: ["JOB", "TRIP", "INVOICE"],
  })
  @IsIn(["JOB", "TRIP", "INVOICE"])
  entityType!: "JOB" | "TRIP" | "INVOICE";

  @ApiProperty()
  @IsString()
  entityId!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  jobId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  tripId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  invoiceId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  jobNo!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  tripRef!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  containerNo!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  customerName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  driverName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  invoiceNo!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "ISO timestamp used to place this exception in a date cohort.",
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  reportingTimestamp!: Date | null;

  @ApiProperty()
  @IsString()
  explanation!: string;

  @ApiProperty()
  @IsString()
  href!: string;

  @ApiProperty()
  @IsBoolean()
  resolvableInOpsFlow!: boolean;
}

export class StatisticsExceptionCountDto {
  @ApiProperty({ enum: STATISTICS_EXCEPTION_KEYS })
  @IsIn(STATISTICS_EXCEPTION_KEYS)
  key!: StatisticsExceptionKey;

  @ApiProperty()
  @IsInt()
  @Min(0)
  count!: number;
}

export class StatisticsExceptionsDto extends StatisticsResponseBaseDto {
  @ApiProperty({ type: [StatisticsExceptionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatisticsExceptionItemDto)
  data: StatisticsExceptionItemDto[] = [];

  @ApiProperty({ type: StatisticsPaginationMetaDto })
  @ValidateNested()
  @Type(() => StatisticsPaginationMetaDto)
  meta!: StatisticsPaginationMetaDto;

  @ApiProperty({ type: [StatisticsExceptionCountDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatisticsExceptionCountDto)
  countsByKey: StatisticsExceptionCountDto[] = [];
}

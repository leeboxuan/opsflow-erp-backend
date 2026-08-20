import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import {
  JOB_FINANCE_STATUSES,
  type JobFinanceStatus,
} from "../job-finance-summary.helpers";

export class JobFinanceSummaryDto {
  @ApiProperty()
  @IsString()
  jobId!: string;

  @ApiPropertyOptional({ nullable: true })
  jobInternalRef!: string | null;

  @ApiProperty({ example: "SGD" })
  @IsString()
  currency!: string;

  @ApiProperty()
  @IsInt()
  driverPayoutCents!: number;

  @ApiProperty({
    description: "Approved Phase 2 trip expenses (misc cost); reimbursement never doubles.",
  })
  @IsInt()
  miscPayoutCents!: number;

  @ApiProperty()
  @IsInt()
  totalCostCents!: number;

  @ApiProperty()
  @IsInt()
  totalJobBillableCents!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: "Sum of ISSUED|PAID invoice totalCents for the job; null when none.",
  })
  invoiceRevenueCents!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "totalCostCents - invoiceRevenueCents when invoiced; null when NOT_INVOICED.",
  })
  differenceCents!: number | null;

  @ApiProperty({ enum: JOB_FINANCE_STATUSES })
  financeStatus!: JobFinanceStatus;
}

export class ListJobFinanceSummariesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ enum: JOB_FINANCE_STATUSES })
  @IsOptional()
  @IsEnum(JOB_FINANCE_STATUSES)
  financeStatus?: JobFinanceStatus;
}

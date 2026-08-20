import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  TripExpenseCategory,
  TripExpensePaymentMethod,
  TripExpenseReimbursementStatus,
  TripExpenseReviewStatus,
} from "@prisma/client";
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { Type } from "class-transformer";
import { TRIP_EXPENSE_MAX_AMOUNT_CENTS } from "../trip-expense.rules";

export class CreateTripExpenseDto {
  @ApiProperty({ enum: TripExpenseCategory })
  @IsEnum(TripExpenseCategory)
  category!: TripExpenseCategory;

  @ApiProperty({ enum: TripExpensePaymentMethod })
  @IsEnum(TripExpensePaymentMethod)
  paymentMethod!: TripExpensePaymentMethod;

  @ApiProperty({ description: "Amount in integer cents" })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TRIP_EXPENSE_MAX_AMOUNT_CENTS)
  amountCents!: number;

  @ApiPropertyOptional({ default: "SGD" })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @ApiProperty({ description: "ISO date YYYY-MM-DD" })
  @IsISO8601({ strict: true })
  transactionDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;

  @ApiProperty({
    description:
      "Client-generated idempotency key (UUID or high-entropy). Required; reused only for retries of this submission.",
  })
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  operationKey!: string;
}

export class UpdateTripExpenseDto {
  @ApiPropertyOptional({ enum: TripExpenseCategory })
  @IsOptional()
  @IsEnum(TripExpenseCategory)
  category?: TripExpenseCategory;

  @ApiPropertyOptional({ enum: TripExpensePaymentMethod })
  @IsOptional()
  @IsEnum(TripExpensePaymentMethod)
  paymentMethod?: TripExpensePaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TRIP_EXPENSE_MAX_AMOUNT_CENTS)
  amountCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  transactionDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;

  @ApiProperty({
    description:
      "Client-generated idempotency key required for retryable resubmission/edit.",
  })
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  operationKey!: string;
}

export class AddTripExpenseAttachmentDto {
  @ApiProperty({
    description: "Client-generated idempotency key for this attachment upload.",
  })
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  operationKey!: string;
}

/** Approve may include optional permitted financial corrections. */
export class ApproveTripExpenseDto {
  @ApiPropertyOptional({ description: "Optional approval note" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({ description: "Optional reviewer correction to amount cents" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TRIP_EXPENSE_MAX_AMOUNT_CENTS)
  amountCents?: number;

  @ApiPropertyOptional({ enum: TripExpenseCategory })
  @IsOptional()
  @IsEnum(TripExpenseCategory)
  category?: TripExpenseCategory;

  @ApiPropertyOptional({ enum: TripExpensePaymentMethod })
  @IsOptional()
  @IsEnum(TripExpensePaymentMethod)
  paymentMethod?: TripExpensePaymentMethod;
}

/** Reject accepts only a non-empty reason. */
export class RejectTripExpenseDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}

/** Clarification accepts only a non-empty reason. */
export class RequestTripExpenseClarificationDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}

export class ListTripExpensesQueryDto {
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

  @ApiPropertyOptional({ enum: TripExpenseReviewStatus })
  @IsOptional()
  @IsEnum(TripExpenseReviewStatus)
  reviewStatus?: TripExpenseReviewStatus;

  @ApiPropertyOptional({ enum: TripExpenseReimbursementStatus })
  @IsOptional()
  @IsEnum(TripExpenseReimbursementStatus)
  reimbursementStatus?: TripExpenseReimbursementStatus;

  @ApiPropertyOptional({ enum: TripExpenseCategory })
  @IsOptional()
  @IsEnum(TripExpenseCategory)
  category?: TripExpenseCategory;

  @ApiPropertyOptional({ enum: TripExpensePaymentMethod })
  @IsOptional()
  @IsEnum(TripExpensePaymentMethod)
  paymentMethod?: TripExpensePaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  driverUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  jobId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tripId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  transactionDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  transactionDateTo?: string;
}

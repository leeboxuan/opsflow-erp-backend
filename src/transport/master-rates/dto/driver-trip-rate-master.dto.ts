import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from "class-validator";

export class CreateDriverTripRateMasterDto {
  @ApiProperty({ example: "TRIP_A" })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty({ example: "Trip A earning" })
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiPropertyOptional({ example: 4500, description: "Amount in cents" })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;

  @ApiPropertyOptional({ default: "SGD" })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateDriverTripRateMasterDto {
  @ApiPropertyOptional({ example: "TRIP_A_UPDATED" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  code?: string;

  @ApiPropertyOptional({ example: "Trip A earning updated" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  @ApiPropertyOptional({ example: 5000, description: "Amount in cents" })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;

  @ApiPropertyOptional({ example: "SGD" })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class DriverTripRateImportItemDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  label!: string;

  @ApiPropertyOptional({ nullable: true })
  amountCents!: number | null;

  @ApiProperty()
  currency!: string;

  @ApiPropertyOptional({ nullable: true })
  rawRateText!: string | null;

  @ApiProperty()
  requiresManualAmount!: boolean;

  @ApiProperty()
  hasMultipleRates!: boolean;

  @ApiPropertyOptional({ nullable: true })
  rateOptionsJson!: Array<{ label: string; amountCents: number | null }> | null;

  @ApiPropertyOptional({ nullable: true })
  defaultRateOptionIndex!: number | null;
}

export class DriverTripRateImportErrorDto {
  @ApiProperty({ example: 3 })
  rowNumber!: number;

  @ApiProperty({ example: "code is required" })
  reason!: string;
}

export class DriverTripRateImportSummaryDto {
  @ApiProperty()
  createdCount!: number;

  @ApiProperty()
  updatedCount!: number;

  @ApiProperty()
  skippedCount!: number;

  @ApiProperty({ type: [DriverTripRateImportErrorDto] })
  errors!: DriverTripRateImportErrorDto[];

  @ApiProperty({ type: [DriverTripRateImportItemDto] })
  items!: DriverTripRateImportItemDto[];
}

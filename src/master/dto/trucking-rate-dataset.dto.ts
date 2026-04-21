import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, ValidateNested } from "class-validator";

export class TruckingRateOptionDto {
  @ApiProperty()
  @IsString()
  label: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  amountCents?: number | null;
}

export class TruckingRateItemDto {
  @ApiProperty()
  @IsString()
  code: string;

  @ApiProperty()
  @IsString()
  label: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  amountCents?: number | null;

  @ApiPropertyOptional({ default: "SGD" })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  rawRateText?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresManualAmount?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasMultipleRates?: boolean;

  @ApiPropertyOptional({ type: [TruckingRateOptionDto], nullable: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TruckingRateOptionDto)
  rateOptionsJson?: TruckingRateOptionDto[] | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  defaultRateOptionIndex?: number | null;
}

export class SaveTruckingRatesDatasetDto {
  @ApiProperty({ type: [TruckingRateItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TruckingRateItemDto)
  items: TruckingRateItemDto[];
}

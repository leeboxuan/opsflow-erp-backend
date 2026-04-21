import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, ValidateNested } from "class-validator";

export class DhcRateOptionDto {
  @ApiProperty()
  @IsString()
  label: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  amountCents?: number | null;
}

export class DhcRateItemDto {
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

  @ApiPropertyOptional({ type: [DhcRateOptionDto], nullable: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DhcRateOptionDto)
  rateOptionsJson?: DhcRateOptionDto[] | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  defaultRateOptionIndex?: number | null;
}

export class SaveDhcRatesDatasetDto {
  @ApiProperty({ type: [DhcRateItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DhcRateItemDto)
  items: DhcRateItemDto[];
}

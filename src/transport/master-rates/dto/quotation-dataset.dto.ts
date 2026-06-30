import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, ValidateNested } from "class-validator";

export class QuotationDatasetItemDto {
  @ApiProperty()
  @IsString()
  code: string;

  @ApiProperty()
  @IsString()
  label: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  section?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  containerSize?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tripMode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  areaScope?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  rateCents?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresManualAmount?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  rawRateText?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class SaveQuotationDatasetDto {
  @ApiProperty({ type: [QuotationDatasetItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationDatasetItemDto)
  items: QuotationDatasetItemDto[];
}

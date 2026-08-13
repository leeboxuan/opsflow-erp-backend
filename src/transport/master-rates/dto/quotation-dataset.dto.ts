import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";

export class QuotationDatasetItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

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

  @ApiPropertyOptional({
    description: "Semantic metadata (annex, variant, rules, 20/40 rates)",
  })
  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  rate20ftCents?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  rate40ftCents?: number | null;

  @ApiPropertyOptional({ default: "SGD" })
  @IsOptional()
  @IsString()
  currency?: string | null;
}

export class MutateQuotationDatasetItemDto extends QuotationDatasetItemDto {
  @ApiPropertyOptional({
    description:
      "Optimistic concurrency: current dataset versionNo expected by the client",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersionNo?: number;
}

export class SaveQuotationDatasetDto {
  @ApiProperty({ type: [QuotationDatasetItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationDatasetItemDto)
  items: QuotationDatasetItemDto[];

  @ApiPropertyOptional({
    description:
      "Optimistic concurrency: current dataset versionNo expected by the client",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersionNo?: number;
}

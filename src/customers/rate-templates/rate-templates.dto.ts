import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export const CUSTOMER_RATE_TEMPLATE_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "ARCHIVED",
] as const;

export type CustomerRateTemplateStatusDto =
  (typeof CUSTOMER_RATE_TEMPLATE_STATUSES)[number];

export class CreateBlankRateTemplateDto {
  @ApiProperty({ example: "Acme rate card 2026" })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional({ default: "SGD" })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: "ISO date" })
  @IsOptional()
  @IsString()
  effectiveFrom?: string;

  @ApiPropertyOptional({ description: "ISO date" })
  @IsOptional()
  @IsString()
  effectiveTo?: string;
}

export class CreateRateTemplateFromMasterDto {
  @ApiProperty({ example: "Acme from master Quotation v3" })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ default: "SGD" })
  @IsOptional()
  @IsString()
  currency?: string;
}

export class DuplicateRateTemplateDto {
  @ApiPropertyOptional({ description: "Override name; defaults to Copy of …" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}

export class UpdateRateTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ enum: CUSTOMER_RATE_TEMPLATE_STATUSES })
  @IsOptional()
  @IsIn(CUSTOMER_RATE_TEMPLATE_STATUSES)
  status?: CustomerRateTemplateStatusDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  effectiveFrom?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  effectiveTo?: string | null;
}

export class RateTemplateRowInputDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  code: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
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
  unit?: string | null;

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

  @ApiPropertyOptional({ default: "SGD" })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  rateCents?: number | null;

  @ApiPropertyOptional()
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

  @ApiPropertyOptional()
  @IsOptional()
  rateOptionsJson?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  defaultRateOptionIndex?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  metadataJson?: unknown;

  @ApiPropertyOptional({ description: "Audit-only; never used for live recalc" })
  @IsOptional()
  @IsString()
  sourceMasterRowId?: string | null;
}

export class ReplaceRateTemplateRowsDto {
  @ApiProperty({ type: [RateTemplateRowInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RateTemplateRowInputDto)
  rows: RateTemplateRowInputDto[];
}

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export const CUSTOMER_QUOTATION_STATUSES = [
  "DRAFT",
  "ISSUED",
  "SIGNED",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "VOID",
  "CANCELLED",
] as const;

export const CUSTOMER_QUOTATION_ACCEPTANCE_METHODS = [
  "EMAIL",
  "PORTAL",
  "PHONE",
  "SIGNED_DOCUMENT",
  "OTHER",
] as const;

export type CustomerQuotationStatusDto =
  (typeof CUSTOMER_QUOTATION_STATUSES)[number];
export type CustomerQuotationAcceptanceMethodDto =
  (typeof CUSTOMER_QUOTATION_ACCEPTANCE_METHODS)[number];

export class ListCustomerQuotationsQueryDto {
  @ApiPropertyOptional({ enum: CUSTOMER_QUOTATION_STATUSES })
  @IsOptional()
  @IsIn(CUSTOMER_QUOTATION_STATUSES)
  status?: CustomerQuotationStatusDto;
}

export class CreateBlankCustomerQuotationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

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
  validFrom?: string;

  @ApiPropertyOptional({ description: "ISO date" })
  @IsOptional()
  @IsString()
  validUntil?: string;
}

export class CreateCustomerQuotationFromTemplateDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  templateId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: "ISO date" })
  @IsOptional()
  @IsString()
  validFrom?: string;

  @ApiPropertyOptional({ description: "ISO date" })
  @IsOptional()
  @IsString()
  validUntil?: string;
}

export class CreateCustomerQuotationFromMasterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: "ISO date" })
  @IsOptional()
  @IsString()
  validFrom?: string;

  @ApiPropertyOptional({ description: "ISO date" })
  @IsOptional()
  @IsString()
  validUntil?: string;

  @ApiPropertyOptional({ default: "SGD" })
  @IsOptional()
  @IsString()
  currency?: string;
}

export class CreateCustomerQuotationFromRateExcelDto {
  @ApiPropertyOptional({
    description: "Quotation title; defaults to Excel file name without extension",
  })
  @IsOptional()
  @IsString()
  title?: string;
}

export class UpdateCustomerQuotationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string | null;

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
  validFrom?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  validUntil?: string | null;

  @ApiPropertyOptional({
    description:
      "When changing customerCompanyId on a populated draft, must be true",
  })
  @IsOptional()
  @IsString()
  customerCompanyId?: string;

  @ApiPropertyOptional({
    description:
      "Required true when draft is populated (has lines or sourceTemplateId) and customerCompanyId changes",
  })
  @IsOptional()
  @IsBoolean()
  confirmCustomerChange?: boolean;
}

export class CustomerQuotationLineInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;

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
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string | null;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  qty?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  unitPriceCents?: number;

  @ApiPropertyOptional({ default: "SGD" })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ default: "SR" })
  @IsOptional()
  @IsString()
  taxCode?: string;

  @ApiPropertyOptional({
    default: 900,
    description: "Basis points; 900 = 9%",
  })
  @IsOptional()
  @IsInt()
  taxRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresManualAmount?: boolean;

  @ApiPropertyOptional({ description: "Audit-only" })
  @IsOptional()
  @IsString()
  sourceTemplateRowId?: string | null;

  @ApiPropertyOptional({ description: "Audit-only" })
  @IsOptional()
  @IsString()
  sourceMasterRowId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  metadataJson?: unknown;
}

export class ReplaceCustomerQuotationLinesDto {
  @ApiProperty({ type: [CustomerQuotationLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomerQuotationLineInputDto)
  lines: CustomerQuotationLineInputDto[];
}

export class AcceptCustomerQuotationDto {
  @ApiProperty({ enum: CUSTOMER_QUOTATION_ACCEPTANCE_METHODS })
  @IsIn(CUSTOMER_QUOTATION_ACCEPTANCE_METHODS)
  acceptanceMethod: CustomerQuotationAcceptanceMethodDto;

  @ApiProperty({
    description:
      "Required evidence of customer acceptance. acceptedByUserId is staff recorder only.",
  })
  @IsString()
  @MinLength(1)
  acceptanceEvidenceNote: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  acceptanceEvidenceStorageKey?: string;
}

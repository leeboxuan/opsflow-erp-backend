import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsDateString,
  IsArray,
  ValidateNested,
  MinLength,
} from "class-validator";
import { Type } from "class-transformer";

/** Pickup defaults sent in multipart with file for LCL preview */
export class LclImportPreviewRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  customerCompanyId: string;

  @ApiProperty({ description: "ISO date YYYY-MM-DD" })
  @IsString()
  @MinLength(1)
  pickupDate: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  pickupAddress1: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupAddress2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupPostal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupContactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupContactPhone?: string;
}

/** One preview row per unique Order Ref (grouped) */
export class LclImportPreviewRowDto {
  rowKey: string;
  externalRef: string;
  receiverName: string;
  receiverPhone: string;
  deliveryAddress1: string;
  deliveryAddress2?: string;
  deliveryPostal?: string;
  deliveryCity?: string;
  deliveryCountry?: string;
  itemsSummary?: string;
  specialRequest?: string;
  errors: string[];
}

export class LclImportPreviewStatsDto {
  total: number;
  valid: number;
  invalid: number;
}

export class LclImportPreviewResponseDto {
  template: string;
  customerCompanyId: string;
  pickupDefaults: {
    pickupDate: string;
    pickupAddress1: string;
    pickupAddress2?: string;
    pickupPostal?: string;
    pickupContactName?: string;
    pickupContactPhone?: string;
  };
  rows: LclImportPreviewRowDto[];
  stats: LclImportPreviewStatsDto;
}

/** Single row for LCL confirm (from preview, possibly edited) */
export class LclImportConfirmRowDto {
  @ApiProperty()
  @IsString()
  rowKey: string;

  @ApiProperty()
  @IsString()
  externalRef: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  receiverName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  receiverPhone: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  deliveryAddress1: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryAddress2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryPostal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  itemsSummary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialRequest?: string;
}

export class LclImportConfirmRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  customerCompanyId: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  pickupDate: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  pickupAddress1: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupAddress2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupPostal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupContactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupContactPhone?: string;

  @ApiProperty({ type: [LclImportConfirmRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LclImportConfirmRowDto)
  rows: LclImportConfirmRowDto[];
}

export class LclImportConfirmFailedRowDto {
  rowKey: string;
  reason: string;
}

export class LclImportConfirmCreatedDto {
  id: string;
  internalRef: string;
  externalRef: string | null;
}

export class LclImportConfirmResponseDto {
  createdCount: number;
  failedRows: LclImportConfirmFailedRowDto[];
  created: LclImportConfirmCreatedDto[];
}

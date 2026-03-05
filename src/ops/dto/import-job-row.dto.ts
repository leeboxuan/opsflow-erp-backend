import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsOptional,
  IsString,
  IsDateString,
  MinLength,
  IsEmail,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import { JobType } from "@prisma/client";

/**
 * Single row for job import (preview output / confirm input).
 * Frontend may send back edited rows from preview.
 */
export class ImportJobRowDto {
  @ApiPropertyOptional({ description: "Company name or code; resolved to customerCompanyId" })
  @IsOptional()
  @IsString()
  companyCode?: string;

  @ApiPropertyOptional({ description: "Customer company id (use instead of companyCode)" })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiProperty({ enum: JobType })
  @IsEnum(JobType)
  jobType: JobType;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  pickupAddress: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupAddress2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupPostal?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  deliveryAddress: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryAddress2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryPostal?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  receiverName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  receiverPhone: string;

  @ApiProperty({ description: "ISO date (YYYY-MM-DD)" })
  @IsDateString()
  pickupDate: string;

  @ApiPropertyOptional({ description: "Resolved to driverId if valid DRIVER in tenant" })
  @IsOptional()
  @IsString()
  @IsEmail()
  driverEmail?: string;
}

/** Response row from preview: parsed data + validation errors + resolved ids when valid */
export class ImportPreviewRowDto {
  rowNumber: number;
  data: ImportJobRowDto;
  errors: string[];
  customerCompanyId?: string;
  driverId?: string;
}

export class ImportPreviewResponseDto {
  rows: ImportPreviewRowDto[];
}

/**
 * Row for confirm request. Same shape as preview data; all fields optional at DTO level
 * so that partially edited rows are accepted and reported in failedRows after server-side validation.
 */
export class ImportConfirmRowDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiPropertyOptional({ enum: JobType })
  @IsOptional()
  @IsEnum(JobType)
  jobType?: JobType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiverName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiverPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsEmail()
  driverEmail?: string;

  @ApiPropertyOptional({ description: "For failedRows reporting" })
  @IsOptional()
  @IsInt()
  @Min(1)
  rowNumber?: number;
}

export class ImportConfirmRequestDto {
  @ApiProperty({ type: [ImportConfirmRowDto], description: "Rows from preview (possibly edited)" })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportConfirmRowDto)
  rows: ImportConfirmRowDto[];
}

export class ImportConfirmResponseDto {
  createdCount: number;
  failedRows: { rowNumber: number; reason: string }[];
}

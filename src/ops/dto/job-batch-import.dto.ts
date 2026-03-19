import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsString,
  MinLength,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsOptional,
  IsDateString,
} from "class-validator";
import { Type } from "class-transformer";
import { JobType } from "@prisma/client";

/** Normalized row-level fields (shared customer + jobType come from request). */
export class JobBatchImportRowDto {
  @ApiPropertyOptional({
    description: "Client / order reference for this row",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  externalRef?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiProperty({ description: "ISO date YYYY-MM-DD" })
  @IsDateString()
  pickupDate: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  pickupAddress1: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  pickupAddress2?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  pickupPostal?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  pickupContactName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  pickupContactPhone?: string | null;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  deliveryAddress1: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  deliveryAddress2?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  deliveryPostal?: string | null;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  receiverName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  receiverPhone: string;

  @ApiPropertyOptional({
    description: "If set with itemQty, a job line item is created",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  itemCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  itemQty?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  itemDescription?: string | null;
}

export class JobBatchImportPreviewRowDto {
  @ApiProperty()
  rowNumber: number;

  @ApiProperty({ type: JobBatchImportRowDto })
  data: JobBatchImportRowDto;

  @ApiProperty({ type: [String] })
  errors: string[];
}

export class JobBatchImportPreviewResponseDto {
  @ApiProperty()
  customerCompanyId: string;

  @ApiProperty({ enum: JobType })
  jobType: JobType;

  @ApiProperty({ type: [JobBatchImportPreviewRowDto] })
  rows: JobBatchImportPreviewRowDto[];
}

/** Confirm payload row: same shape as preview data; rowNumber required for reporting. */
export class JobBatchImportConfirmRowDto extends JobBatchImportRowDto {
  @ApiProperty({ description: "1-based sheet row index from preview" })
  @IsInt()
  @Min(1)
  rowNumber: number;
}

export class JobBatchImportConfirmRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  customerCompanyId: string;

  @ApiProperty({ enum: JobType })
  @IsEnum(JobType)
  jobType: JobType;

  @ApiProperty({ type: [JobBatchImportConfirmRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JobBatchImportConfirmRowDto)
  rows: JobBatchImportConfirmRowDto[];
}

export class JobBatchImportConfirmFailedRowDto {
  @ApiProperty()
  rowNumber: number;

  @ApiProperty()
  reason: string;
}

export class JobBatchImportConfirmResponseDto {
  @ApiProperty()
  createdCount: number;

  @ApiProperty({ type: [String] })
  createdIds: string[];

  @ApiProperty({ type: [JobBatchImportConfirmFailedRowDto] })
  failedRows: JobBatchImportConfirmFailedRowDto[];
}

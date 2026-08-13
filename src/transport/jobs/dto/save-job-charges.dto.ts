import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { JobChargeSourceType } from "@prisma/client";

export class SaveJobChargeLineDto {
  @ApiProperty({ enum: JobChargeSourceType })
  @IsEnum(JobChargeSourceType)
  sourceType!: JobChargeSourceType;

  @ApiPropertyOptional({
    description: "Quotation rate line id, DHC id, or driver rate master id when applicable",
  })
  @IsOptional()
  @IsString()
  sourceRefId?: string | null;

  @ApiPropertyOptional({
    description:
      "Required for new CUSTOMER_QUOTATION charges. Must belong to the job's bound accepted quotation. Omit for historical master-sourced CUSTOMER_QUOTATION snapshots.",
  })
  @IsOptional()
  @IsString()
  sourceCustomerQuotationLineId?: string | null;

  @ApiProperty()
  @IsString()
  code!: string;

  @ApiProperty()
  @IsString()
  label!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ default: 1 })
  @IsInt()
  @Min(1)
  qty!: number;

  @ApiProperty({ description: "Unit price cents" })
  @IsInt()
  @Min(0)
  unitPriceCents!: number;

  @ApiPropertyOptional({ default: "SGD" })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  taxable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxCode?: string | null;

  @ApiPropertyOptional({ description: "Basis points, e.g. 900 = 9%" })
  @IsOptional()
  @IsInt()
  taxRateBasisPoints?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  overrideReason?: string | null;
}

export class SaveJobChargesDto {
  @ApiProperty({ type: [SaveJobChargeLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveJobChargeLineDto)
  charges!: SaveJobChargeLineDto[];
}

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsOptional,
  IsString,
  IsDateString,
  MinLength,
  IsNumber,
  IsBoolean,
} from "class-validator";
import { JobType } from "@prisma/client";
import { Type } from "class-transformer";
import { IsArray, ValidateNested } from "class-validator";

export class UpdateJobItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  itemCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  qty?: number;
}
  
export class UpdateJobDto {
  @ApiPropertyOptional({ enum: JobType })
  @IsOptional()
  @IsEnum(JobType)
  jobType?: JobType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerCompanyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  pickupDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  pickupAddress1?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  deliveryAddress1?: string;

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
  @MinLength(1)
  receiverName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  receiverPhone?: string;

  @ApiPropertyOptional({
    description:
      "Client order reference (external ref). Omit to leave unchanged, set to null to clear.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  externalRef?: string | null;

  @ApiPropertyOptional({ type: [UpdateJobItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateJobItemDto)
  items?: UpdateJobItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupPortCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  portTerminalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  portName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  psaStorageRentLastDay?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vesselName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  vesselEta?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  portnetReady?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  permitReady?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  returningDepotCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  returnLastDay?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  exportOriginDepotCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  exportPortCode?: string;
}

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsOptional,
  IsString,
  IsDateString,
  MinLength,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  IsBoolean,
} from "class-validator";
import { JobType } from "@prisma/client";
import { Type } from "class-transformer";


export class CreateJobItemDto {
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

export class CreateJobDto {
  @ApiProperty({ enum: JobType })
  @IsEnum(JobType)
  jobType: JobType;

  @ApiProperty()
  @IsString()
  customerCompanyId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  pickupDate?: string;

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

  @ApiProperty()
  @IsString()
  @MinLength(1)
  receiverName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  receiverPhone: string;

  @ApiPropertyOptional({
    description:
      "Client order reference (external ref). Omit or set to null if not provided.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  externalRef?: string | null;

  @ApiPropertyOptional({ type: [CreateJobItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJobItemDto)
  items?: CreateJobItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  notes?: string;

  @ApiPropertyOptional({ description: "Required for IMPORT; must match master_singapore_ports.code" })
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

  @ApiPropertyOptional({ description: "master_singapore_depots.code" })
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



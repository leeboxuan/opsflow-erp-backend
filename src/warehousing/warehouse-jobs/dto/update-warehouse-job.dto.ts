import { ApiPropertyOptional } from '@nestjs/swagger';
import { WarehouseJobPriority, WarehouseJobType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CreateWarehouseJobContainerDto } from './create-warehouse-job-container.dto';

export class UpdateWarehouseJobDto {
  @ApiPropertyOptional({ enum: WarehouseJobType })
  @IsOptional()
  @IsEnum(WarehouseJobType)
  type?: WarehouseJobType;

  @ApiPropertyOptional({ enum: WarehouseJobPriority })
  @IsOptional()
  @IsEnum(WarehouseJobPriority)
  priority?: WarehouseJobPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  containerNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sealNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  warehouseNotes?: string;

  @ApiPropertyOptional({ type: [CreateWarehouseJobContainerDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWarehouseJobContainerDto)
  containers?: CreateWarehouseJobContainerDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerCompanyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inventoryBatchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedToUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalRefType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalRefId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orderReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receivingVessel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  placeOfDelivery?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  destinationCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  arrivalDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  departureDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  generateDeliveryOrder?: boolean;
}

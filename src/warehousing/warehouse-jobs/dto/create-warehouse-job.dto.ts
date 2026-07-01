import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WarehouseJobPriority, WarehouseJobType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CreateWarehouseJobLineDto } from './create-warehouse-job-line.dto';

export class CreateWarehouseJobDto {
  @ApiProperty({ enum: WarehouseJobType })
  @IsEnum(WarehouseJobType)
  type!: WarehouseJobType;

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

  @ApiPropertyOptional({ type: [CreateWarehouseJobLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWarehouseJobLineDto)
  lines?: CreateWarehouseJobLineDto[];
}

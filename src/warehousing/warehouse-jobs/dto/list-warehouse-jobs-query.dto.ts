import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  WarehouseJobPriority,
  WarehouseJobStatus,
  WarehouseJobType,
} from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ListQueryBaseDto } from '../../../shared/common/dto';

export class ListWarehouseJobsQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional({ enum: WarehouseJobStatus })
  @IsOptional()
  @IsEnum(WarehouseJobStatus)
  status?: WarehouseJobStatus;

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
  @IsString()
  csInChargeUserId?: string;

  @ApiPropertyOptional({ description: 'Search internalRef, title, or external ref' })
  @IsOptional()
  @IsString()
  search?: string;
}

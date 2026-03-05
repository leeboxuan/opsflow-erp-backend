import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { ListQueryBaseDto } from '../../common/dto';

export const BATCH_STATUS_FILTER = ['Draft', 'Open', 'Completed', 'Cancelled'] as const;

export class ListItemsQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional({ description: 'Search term for SKU, name, or reference' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class ListBatchesQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({ enum: BATCH_STATUS_FILTER })
  @IsOptional()
  @IsIn(BATCH_STATUS_FILTER)
  status?: string;
}

export class ListUnitsQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inventoryItemId?: string;

  @ApiPropertyOptional({ default: 'Available' })
  @IsOptional()
  @IsString()
  status?: string = 'Available';
}

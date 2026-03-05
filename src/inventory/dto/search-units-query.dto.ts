import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ListQueryBaseDto } from '../../common/dto';

export class SearchUnitsQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional({
    description: 'Prefix match on unitSku (best for performance)',
    example: 'LLSG-CB',
  })
  @IsOptional()
  @IsString()
  prefix?: string;

  @ApiPropertyOptional({
    description: 'General search (contains) on unitSku and item SKU',
    example: 'MSM',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by item SKU (inventory_items.sku)',
    example: 'LLSG-CB-SS-MSM',
  })
  @IsOptional()
  @IsString()
  itemSku?: string;

  @ApiPropertyOptional({ description: 'Filter by unit status', example: 'Available' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by batchId' })
  @IsOptional()
  @IsString()
  batchId?: string;

  @ApiPropertyOptional({ description: 'Filter by transportOrderId' })
  @IsOptional()
  @IsString()
  transportOrderId?: string;
}

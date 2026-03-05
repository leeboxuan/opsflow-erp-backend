import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SearchUnitsQueryDto {
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

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

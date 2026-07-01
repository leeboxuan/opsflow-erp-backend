import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateWarehouseJobExecutionDto {
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
}

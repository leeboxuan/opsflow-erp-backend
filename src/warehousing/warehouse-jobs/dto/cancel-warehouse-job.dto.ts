import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CancelWarehouseJobDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

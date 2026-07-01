import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WarehouseJobStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateWarehouseJobStatusDto {
  @ApiProperty({ enum: WarehouseJobStatus })
  @IsEnum(WarehouseJobStatus)
  status!: WarehouseJobStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

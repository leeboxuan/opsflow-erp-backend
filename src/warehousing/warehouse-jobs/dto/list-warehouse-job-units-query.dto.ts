import { ApiPropertyOptional } from '@nestjs/swagger';
import { WarehouseJobUnitLinkStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ListWarehouseJobUnitsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lineId?: string;

  @ApiPropertyOptional({ enum: WarehouseJobUnitLinkStatus })
  @IsOptional()
  @IsEnum(WarehouseJobUnitLinkStatus)
  linkStatus?: WarehouseJobUnitLinkStatus;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { InventoryUnitStatus } from '@prisma/client';

export class UpdateUnitStatusDto {
  @ApiProperty({ enum: InventoryUnitStatus })
  @IsEnum(InventoryUnitStatus)
  status!: InventoryUnitStatus;
}

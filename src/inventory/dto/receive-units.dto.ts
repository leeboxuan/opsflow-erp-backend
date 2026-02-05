import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsOptional, Min } from 'class-validator';

export class ReceiveUnitsDto {
  @ApiProperty()
  @IsString()
  inventorySku: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  inventoryName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  unitSkuPrefix?: string;
}

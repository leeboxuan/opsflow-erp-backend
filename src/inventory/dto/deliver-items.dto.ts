import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsOptional } from 'class-validator';

export class DeliverItemsDto {
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  unitSkus?: string[];
}

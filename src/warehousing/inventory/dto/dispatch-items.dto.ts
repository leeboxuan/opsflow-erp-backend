import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsOptional } from 'class-validator';

export class DispatchItemsDto {
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  unitSkus?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  tripId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  stopId?: string;
}

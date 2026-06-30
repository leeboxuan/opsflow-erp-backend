import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsInt, IsOptional, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ReserveItemDto {
  @ApiProperty()
  @IsString()
  inventorySku: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  batchId?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qty: number;
}

export class ReserveItemsDto {
  @ApiProperty({ type: [ReserveItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReserveItemDto)
  items: ReserveItemDto[];
}

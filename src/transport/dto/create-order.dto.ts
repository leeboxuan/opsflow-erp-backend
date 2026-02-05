import {
  IsString,
  IsOptional,
  IsArray,
  IsDateString,
  IsNumber,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StopType } from '@prisma/client';

export class CreateOrderStopDto {
  @ApiProperty({ enum: StopType })
  @IsString()
  type: StopType;

  @ApiProperty()
  @IsString()
  addressLine1: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiProperty()
  @IsString()
  city: string;

  @ApiProperty()
  @IsString()
  postalCode: string;

  @ApiProperty()
  @IsString()
  country: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedAt?: string;
}

export class CreateOrderItemDto {
  @ApiProperty({ description: 'Inventory item ID (from GET /inventory/items)' })
  @IsString()
  inventoryItemId: string;

  @ApiProperty({ minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ description: 'Optional batch ID to reserve from' })
  @IsOptional()
  @IsString()
  batchId?: string;
}

export class CreateOrderDto {
  @ApiProperty()
  @IsString()
  orderRef: string;

  @ApiProperty()
  @IsString()
  customerName: string;

  @ApiProperty({ type: [CreateOrderStopDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderStopDto)
  stops: CreateOrderStopDto[];

  @ApiPropertyOptional({ type: [CreateOrderItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items?: CreateOrderItemDto[];
}

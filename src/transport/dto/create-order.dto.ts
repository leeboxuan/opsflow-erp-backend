import {
  IsString,
  IsOptional,
  IsArray,
  IsDateString,
  IsNumber,
  Min,
  ValidateNested,
  ArrayMinSize,
  Matches,
  MaxLength,
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

  // ✅ NEW: +65######## only
  @ApiPropertyOptional({
    description: 'Customer contact number in E.164 (SG only). Example: +6591893401',
    example: '+6591893401',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+65\d{8}$/, {
    message: 'customerContactNumber must be +65 followed by 8 digits',
  })
  customerContactNumber?: string;

  // ✅ NEW: Notes (max 500)
  @ApiPropertyOptional({
    description: 'Notes / special instructions (max 500 chars)',
    example: 'Call before arrival. Leave with guard if no answer.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'notes cannot exceed 500 characters' })
  notes?: string;

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

  // ✅ NEW: Internal OpsFlow reference (DB-YYYY-MM-DD-XXX)
  @ApiPropertyOptional({
    description:
      "Internal reference. If not provided, backend generates DB-YYYY-MM-DD-XXX",
    example: "DB-2026-02-01-IMP",
  })
  @IsOptional()
  @IsString()
  internalRef?: string;
}

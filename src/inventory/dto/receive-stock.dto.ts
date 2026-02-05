import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsString,
  IsNumber,
  Min,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReceiveStockItemDto {
  @ApiProperty({ description: 'Inventory item ID (from GET /inventory/items)' })
  @IsString()
  inventoryItemId: string;

  @ApiProperty({ minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;
}

export class ReceiveStockDto {
  @ApiProperty({ type: [ReceiveStockItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveStockItemDto)
  items: ReceiveStockItemDto[];

  @ApiPropertyOptional({
    enum: ['ITEM-BATCH-SEQ', 'ITEM-SEQ'],
    description: 'unitSku format: ITEM-BATCH-SEQ = <sku>-<batchCode>-<seq>, ITEM-SEQ = <sku>-<seq>',
  })
  @IsOptional()
  @IsString()
  unitSkuFormat?: 'ITEM-BATCH-SEQ' | 'ITEM-SEQ';
}

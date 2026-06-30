import { ApiProperty } from '@nestjs/swagger';

export class InventoryItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ required: false })
  sku?: string;

  @ApiProperty({ required: false })
  name?: string;

  @ApiProperty({ required: false, nullable: true })
  reference?: string | null;

  @ApiProperty({ description: 'Count of units in Available status (InventoryUnitStatus.Available)', example: 10 })
  availableQty: number;
}

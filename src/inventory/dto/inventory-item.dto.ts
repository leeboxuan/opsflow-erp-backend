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

  @ApiProperty({ required: false, nullable: true, description: 'Display unit label (e.g. pcs, box)' })
  unit?: string | null;

  @ApiProperty({ description: 'Count of units in Available status (InventoryUnitStatus.Available)', example: 10 })
  availableQty: number;
}

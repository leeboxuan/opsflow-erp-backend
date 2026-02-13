import { ApiProperty } from '@nestjs/swagger';
import { InventoryBatchStatus } from '@prisma/client';

export class BatchDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  containerNumber: string;

  @ApiProperty({ required: false, nullable: true })
  customerName?: string | null;

  @ApiProperty({ required: false, nullable: true })
  customerRef?: string | null;

  @ApiProperty({ required: false, nullable: true })
  receivedAt?: Date | null;

  @ApiProperty({ required: false, nullable: true })
  notes?: string | null;

  @ApiProperty({ enum: InventoryBatchStatus })
  status: InventoryBatchStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty()
  totalUnits: number;

  @ApiProperty()
  availableUnits: number;

  @ApiProperty()
  reservedUnits: number;

  @ApiProperty()
  inTransitUnits: number;

  @ApiProperty()
  deliveredUnits: number;
}

import { ApiProperty } from '@nestjs/swagger';

export class DriverWalletSummaryDto {
  @ApiProperty()
  driverId: string;

  @ApiProperty()
  driverName: string;

  @ApiProperty()
  totalCents: number;
}

export class DriverWalletTransactionDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  amountCents: number;

  @ApiProperty()
  type: string;

  @ApiProperty()
  referenceId: string | null;

  @ApiProperty()
  createdAt: Date;
}

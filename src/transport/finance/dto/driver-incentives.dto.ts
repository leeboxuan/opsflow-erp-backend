import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class DriverIncentiveSummaryRowDto {
  @ApiProperty({ description: "Driver user id used for the detail route only" })
  driverId!: string;

  @ApiProperty()
  driverName!: string;

  @ApiProperty()
  monthCents!: number;

  @ApiProperty()
  completedTripCount!: number;

  @ApiProperty()
  averageCents!: number;

  @ApiPropertyOptional({ nullable: true })
  vehiclePlate!: string | null;
}

export class DriverIncentiveListDto {
  @ApiProperty({ example: "2026-08" })
  month!: string;

  @ApiProperty({ example: "SGD" })
  currency!: string;

  @ApiProperty()
  timeZone!: string;

  @ApiProperty({ type: [DriverIncentiveSummaryRowDto] })
  data!: DriverIncentiveSummaryRowDto[];
}

export class DriverIncentiveTripRowDto {
  @ApiPropertyOptional({ nullable: true })
  date!: Date | null;

  @ApiProperty()
  tripDisplayRef!: string;

  @ApiPropertyOptional({ nullable: true })
  payoutLabel!: string | null;

  @ApiProperty()
  amountCents!: number;

  @ApiPropertyOptional({ nullable: true })
  jobRef!: string | null;
}

export class DriverIncentiveDetailDto {
  @ApiProperty()
  driverId!: string;

  @ApiProperty()
  driverName!: string;

  @ApiProperty({ example: "2026-08" })
  month!: string;

  @ApiProperty()
  totalCents!: number;

  @ApiProperty()
  completedTripCount!: number;

  @ApiProperty()
  averageCents!: number;

  @ApiPropertyOptional({ nullable: true })
  vehiclePlate!: string | null;

  @ApiProperty({ example: "SGD" })
  currency!: string;

  @ApiProperty()
  timeZone!: string;

  @ApiProperty({ type: [DriverIncentiveTripRowDto] })
  trips!: DriverIncentiveTripRowDto[];
}

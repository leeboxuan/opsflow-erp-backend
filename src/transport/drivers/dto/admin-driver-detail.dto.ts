import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { TripStatus } from "@prisma/client";
import { AdminDriverDto } from "./admin-driver.dto";

export class AdminDriverAssignedTripDto {
  @ApiProperty()
  tripId: string;

  @ApiProperty({ nullable: true })
  jobId: string | null;

  @ApiProperty({ nullable: true })
  jobInternalRef: string | null;

  @ApiProperty({ nullable: true })
  title: string | null;

  @ApiProperty({ enum: TripStatus })
  status: TripStatus;

  @ApiProperty({ nullable: true })
  plannedStartAt: Date | null;

  @ApiProperty({ nullable: true })
  startedAt: Date | null;

  @ApiProperty({ nullable: true })
  originSummary: string | null;

  @ApiProperty({ nullable: true })
  destinationSummary: string | null;

  @ApiProperty({ enum: ["current", "next"] })
  kind: "current" | "next";
}

export class AdminDriverSummaryDto {
  @ApiProperty({ type: AdminDriverDto })
  driver: AdminDriverDto;

  @ApiProperty({ type: AdminDriverAssignedTripDto, nullable: true })
  currentOrNextTrip: AdminDriverAssignedTripDto | null;

  @ApiProperty()
  month: string;

  @ApiProperty()
  monthEarningsCents: number;

  @ApiProperty()
  lifetimeEarningsCents: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  completedTripCountLifetime: number;

  @ApiProperty()
  completedTripCountMonth: number;

  @ApiProperty()
  timeZone: string;
}

export class AdminDriverTripHistoryItemDto {
  @ApiProperty()
  tripId: string;

  @ApiProperty({ nullable: true })
  jobId: string | null;

  @ApiProperty({ nullable: true })
  jobInternalRef: string | null;

  @ApiProperty({ nullable: true })
  title: string | null;

  @ApiProperty({ enum: TripStatus })
  status: TripStatus;

  @ApiProperty({ nullable: true })
  tripDate: Date | null;

  @ApiProperty({ nullable: true })
  closedAt: Date | null;

  @ApiProperty({ nullable: true })
  startedAt: Date | null;

  @ApiProperty({ nullable: true })
  plannedStartAt: Date | null;

  @ApiProperty({ nullable: true })
  originSummary: string | null;

  @ApiProperty({ nullable: true })
  destinationSummary: string | null;

  @ApiProperty()
  stopCount: number;

  @ApiProperty()
  completedStopCount: number;

  @ApiPropertyOptional({ nullable: true })
  driverEarningCents?: number | null;

  @ApiPropertyOptional({ nullable: true })
  earningLabelSnapshot?: string | null;
}

export class AdminDriverEarningsDto {
  @ApiProperty()
  month: string;

  @ApiProperty()
  monthCents: number;

  @ApiProperty()
  lifetimeCents: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  monthCompletedTripCount: number;

  @ApiProperty()
  lifetimeCompletedTripCount: number;

  @ApiProperty()
  timeZone: string;
}

export class AdminDriverEarningsTransactionDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  amountCents: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  type: string;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ nullable: true })
  effectiveAt: Date | null;

  @ApiProperty()
  tripId: string;

  @ApiProperty({ nullable: true })
  jobId: string | null;

  @ApiProperty({ nullable: true })
  jobInternalRef: string | null;
}

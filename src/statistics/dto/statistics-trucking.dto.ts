import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import {
  StatisticsPaginationMetaDto,
  StatisticsResponseBaseDto,
} from "./statistics-response.dto";

export class StatisticsNamedCountDto {
  @ApiProperty()
  @IsString()
  label!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  count!: number;
}

export class StatisticsTruckingSummaryDto extends StatisticsResponseBaseDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  uniqueContainers!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  containerMovements!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  averageMovementsPerContainer!: number | null;

  @ApiProperty()
  @IsInt()
  @Min(0)
  containersHandledByMultipleDrivers!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  jobs!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  completedTrips!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  cancelledTrips!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  avgTripDurationMs!: number | null;

  @ApiProperty()
  @IsInt()
  @Min(0)
  importContainers!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  exportContainers!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  lclContainers!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  collectionContainers!: number;

  @ApiProperty({ type: [StatisticsNamedCountDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatisticsNamedCountDto)
  containerSizeMix: StatisticsNamedCountDto[] = [];

  @ApiProperty({ type: [StatisticsNamedCountDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatisticsNamedCountDto)
  jobTypeMix: StatisticsNamedCountDto[] = [];
}

export class StatisticsContainerMovementRowDto {
  @ApiProperty()
  @IsString()
  movementId!: string;

  @ApiProperty()
  movementDate!: Date;

  @ApiProperty()
  @IsString()
  containerNo!: string;

  @ApiProperty()
  @IsString()
  containerSize!: string;

  @ApiProperty()
  @IsString()
  jobNo!: string;

  @ApiProperty()
  @IsString()
  jobType!: string;

  @ApiProperty()
  @IsString()
  customerName!: string;

  @ApiProperty()
  @IsString()
  tripRef!: string;

  @ApiProperty()
  @IsString()
  origin!: string;

  @ApiProperty()
  @IsString()
  destination!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  driverName!: string | null;

  @ApiProperty()
  @IsString()
  vehiclePlate!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  trailerNo!: string | null;

  @ApiProperty()
  @IsString()
  tripStatus!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  startedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  completedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  durationMs!: number | null;

  @ApiProperty()
  @IsString()
  documentationStatus!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  jobHref?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tripHref?: string;
}

export class StatisticsContainerMovementsDto extends StatisticsResponseBaseDto {
  @ApiProperty({ type: [StatisticsContainerMovementRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatisticsContainerMovementRowDto)
  data: StatisticsContainerMovementRowDto[] = [];

  @ApiProperty({ type: StatisticsPaginationMetaDto })
  @ValidateNested()
  @Type(() => StatisticsPaginationMetaDto)
  meta!: StatisticsPaginationMetaDto;
}

export class StatisticsContainerRowDto {
  @ApiProperty()
  @IsString()
  containerKey!: string;

  @ApiProperty()
  @IsString()
  containerNo!: string;

  @ApiProperty()
  @IsString()
  customers!: string;

  @ApiProperty()
  @IsString()
  jobs!: string;

  @ApiProperty()
  @IsString()
  jobType!: string;

  @ApiProperty()
  @IsString()
  containerSize!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  movements!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  driversTouched!: number;

  @ApiProperty()
  @IsString()
  driverNames!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  vehiclesUsed!: number;

  @ApiProperty()
  @IsString()
  vehiclePlates!: string;

  @ApiProperty()
  firstMovementAt!: Date;

  @ApiProperty()
  lastMovementAt!: Date;

  @ApiProperty()
  @IsString()
  firstOrigin!: string;

  @ApiProperty()
  @IsString()
  finalDestination!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  totalDurationMs!: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  avgDurationMs!: number | null;
}

export class StatisticsContainersDto extends StatisticsResponseBaseDto {
  @ApiProperty({ type: [StatisticsContainerRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatisticsContainerRowDto)
  data: StatisticsContainerRowDto[] = [];

  @ApiProperty({ type: StatisticsPaginationMetaDto })
  @ValidateNested()
  @Type(() => StatisticsPaginationMetaDto)
  meta!: StatisticsPaginationMetaDto;
}

export class StatisticsLaneRowDto {
  @ApiProperty()
  @IsString()
  lane!: string;

  @ApiProperty()
  @IsString()
  origin!: string;

  @ApiProperty()
  @IsString()
  destination!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  movements!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  uniqueContainers!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  uniqueJobs!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  avgDurationMs!: number | null;

  @ApiProperty()
  @IsInt()
  @Min(0)
  driversUsed!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  vehiclesUsed!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  completedTrips!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  cancelledTrips!: number;
}

export class StatisticsLanesDto extends StatisticsResponseBaseDto {
  @ApiProperty({ type: [StatisticsLaneRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatisticsLaneRowDto)
  data: StatisticsLaneRowDto[] = [];

  @ApiProperty({ type: StatisticsPaginationMetaDto })
  @ValidateNested()
  @Type(() => StatisticsPaginationMetaDto)
  meta!: StatisticsPaginationMetaDto;
}

export class StatisticsFleetRowDto {
  @ApiProperty()
  @IsString()
  vehicleKey!: string;

  @ApiProperty()
  @IsString()
  plateNo!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  vehicleType!: string | null;

  @ApiProperty()
  @IsInt()
  @Min(0)
  completedTrips!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  containerMovements!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  uniqueContainers!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  activeDays!: number;

  @ApiProperty()
  @IsString()
  drivers!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  avgTripsPerActiveDay!: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  avgTripDurationMs!: number | null;

  @ApiProperty()
  @IsInt()
  @Min(0)
  cancelledTrips!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  lastActivityAt!: Date | null;
}

export class StatisticsTrailerRowDto {
  @ApiProperty()
  @IsString()
  trailerNo!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  movements!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  uniqueContainers!: number;

  @ApiProperty()
  @IsString()
  drivers!: string;
}

export class StatisticsFleetDto extends StatisticsResponseBaseDto {
  @ApiProperty({ type: [StatisticsFleetRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatisticsFleetRowDto)
  data: StatisticsFleetRowDto[] = [];

  @ApiProperty({ type: [StatisticsTrailerRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatisticsTrailerRowDto)
  trailers: StatisticsTrailerRowDto[] = [];

  @ApiProperty({ type: StatisticsPaginationMetaDto })
  @ValidateNested()
  @Type(() => StatisticsPaginationMetaDto)
  meta!: StatisticsPaginationMetaDto;
}

export class StatisticsCustomerCurrencyGroupDto {
  @ApiProperty()
  @IsString()
  currency!: string;

  @ApiProperty()
  @IsInt()
  jobChargesCents!: number;

  @ApiProperty()
  @IsInt()
  issuedInvoiceValueCents!: number;

  @ApiProperty()
  @IsInt()
  paidInvoiceValueCents!: number;

  @ApiProperty()
  @IsInt()
  uninvoicedReadyValueCents!: number;

  @ApiProperty()
  @IsInt()
  recordedDriverPayoutCents!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  grossProfitCents!: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  grossMarginBasisPoints!: number | null;
}

export class StatisticsCustomerRowDto {
  @ApiProperty()
  @IsString()
  customerName!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  jobs!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  completedJobs!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  uniqueContainers!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  containerMovements!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  completedTrips!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  cancelledTrips!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  averageMovementsPerContainer!: number | null;

  @ApiProperty()
  @IsString()
  jobTypeMix!: string;

  @ApiProperty({ type: [StatisticsCustomerCurrencyGroupDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatisticsCustomerCurrencyGroupDto)
  currencyGroups: StatisticsCustomerCurrencyGroupDto[] = [];

  @ApiProperty()
  profitAggregationAvailable!: boolean;
}

export class StatisticsCustomersDto extends StatisticsResponseBaseDto {
  @ApiProperty({ type: [StatisticsCustomerRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatisticsCustomerRowDto)
  data: StatisticsCustomerRowDto[] = [];

  @ApiProperty({ type: StatisticsPaginationMetaDto })
  @ValidateNested()
  @Type(() => StatisticsPaginationMetaDto)
  meta!: StatisticsPaginationMetaDto;
}

export class StatisticsLookupItemDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty()
  @IsString()
  label!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  sublabel!: string | null;
}

export class StatisticsLookupsDto {
  @ApiProperty({ type: [StatisticsLookupItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatisticsLookupItemDto)
  data: StatisticsLookupItemDto[] = [];
}

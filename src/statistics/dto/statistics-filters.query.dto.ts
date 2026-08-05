import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import {
  DEFAULT_LIST_PAGE,
  DEFAULT_LIST_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
} from "../../shared/common/constants";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FILTER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

@ValidatorConstraint({ name: "statisticsDateRangeOrder", async: false })
class StatisticsDateRangeOrderConstraint
  implements ValidatorConstraintInterface
{
  validate(to: string | undefined, args: ValidationArguments): boolean {
    const from = (args.object as StatisticsFiltersQueryDto).from;
    if (!from || !to) return true;
    return from <= to;
  }

  defaultMessage(): string {
    return "to must be on or after from";
  }
}

function dateDescription(boundary: "from" | "to"): string {
  return `${boundary === "from" ? "Inclusive" : "Inclusive calendar"} date in the tenant timezone (YYYY-MM-DD). The service converts it to an inclusive-exclusive UTC range.`;
}

export class StatisticsFiltersQueryDto {
  @ApiPropertyOptional({
    description: dateDescription("from"),
    example: "2026-07-01",
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: "from must be YYYY-MM-DD" })
  @IsDateString({ strict: true }, { message: "from must be a valid date" })
  from?: string;

  @ApiPropertyOptional({
    description: dateDescription("to"),
    example: "2026-07-31",
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: "to must be YYYY-MM-DD" })
  @IsDateString({ strict: true }, { message: "to must be a valid date" })
  @Validate(StatisticsDateRangeOrderConstraint)
  to?: string;

  @ApiPropertyOptional({ description: "Tenant-scoped customer company id" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(FILTER_ID_PATTERN, { message: "customerId is malformed" })
  customerId?: string;

  @ApiPropertyOptional({ description: "Tenant-scoped Job id" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(FILTER_ID_PATTERN, { message: "jobId is malformed" })
  jobId?: string;

  @ApiPropertyOptional({ description: "Tenant-scoped Trip (job leg) id" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(FILTER_ID_PATTERN, { message: "tripId is malformed" })
  tripId?: string;

  @ApiPropertyOptional({
    description:
      "Tenant-scoped driver user id (matches Trip.assignedDriverUserId)",
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(FILTER_ID_PATTERN, { message: "driverId is malformed" })
  driverId?: string;

  @ApiPropertyOptional({
    description:
      "Tenant-scoped vehicle id; later queries match Trip.vehicleId OR Trip.fleetVehicleId",
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(FILTER_ID_PATTERN, { message: "vehicleId is malformed" })
  vehicleId?: string;
}

export abstract class StatisticsPaginatedFiltersQueryDto extends StatisticsFiltersQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_LIST_PAGE,
    minimum: 1,
    maximum: MAX_PAGE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page?: number = DEFAULT_LIST_PAGE;

  @ApiPropertyOptional({
    default: DEFAULT_LIST_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number = DEFAULT_LIST_PAGE_SIZE;
}

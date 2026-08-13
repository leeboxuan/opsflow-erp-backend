import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { SORT_DIR_VALUES, SortDir } from "../../shared/common/constants";
import {
  STATISTICS_TRUCKING_MOVEMENT_SORT_FIELDS,
  StatisticsTruckingMovementSortField,
} from "../statistics.constants";
import {
  StatisticsFiltersQueryDto,
  StatisticsPaginatedFiltersQueryDto,
} from "./statistics-filters.query.dto";

export class StatisticsTruckingSummaryQueryDto extends StatisticsFiltersQueryDto {}

export class StatisticsTruckingMovementsQueryDto extends StatisticsPaginatedFiltersQueryDto {
  @ApiPropertyOptional({
    enum: STATISTICS_TRUCKING_MOVEMENT_SORT_FIELDS,
    default: "movementDate",
  })
  @IsOptional()
  @IsIn(STATISTICS_TRUCKING_MOVEMENT_SORT_FIELDS)
  sortBy?: StatisticsTruckingMovementSortField = "movementDate";

  @ApiPropertyOptional({ enum: SORT_DIR_VALUES, default: "asc" })
  @IsOptional()
  @IsIn(SORT_DIR_VALUES)
  sortDir?: SortDir = "asc";
}

export class StatisticsTruckingContainersQueryDto extends StatisticsPaginatedFiltersQueryDto {}

export class StatisticsTruckingLanesQueryDto extends StatisticsPaginatedFiltersQueryDto {}

export class StatisticsTruckingFleetQueryDto extends StatisticsPaginatedFiltersQueryDto {}

export class StatisticsCustomersQueryDto extends StatisticsPaginatedFiltersQueryDto {}

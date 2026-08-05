import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import {
  SORT_DIR_VALUES,
  SortDir,
} from "../../shared/common/constants";
import {
  STATISTICS_DRIVER_SORT_FIELDS,
  StatisticsDriverSortField,
} from "../statistics.constants";
import { StatisticsPaginatedFiltersQueryDto } from "./statistics-filters.query.dto";

export class StatisticsDriversQueryDto extends StatisticsPaginatedFiltersQueryDto {
  @ApiPropertyOptional({
    enum: STATISTICS_DRIVER_SORT_FIELDS,
    default: "completedTrips",
  })
  @IsOptional()
  @IsIn(STATISTICS_DRIVER_SORT_FIELDS)
  sortBy?: StatisticsDriverSortField = "completedTrips";

  @ApiPropertyOptional({ enum: SORT_DIR_VALUES, default: "desc" })
  @IsOptional()
  @IsIn(SORT_DIR_VALUES)
  sortDir?: SortDir = "desc";
}

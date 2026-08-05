import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import {
  SORT_DIR_VALUES,
  SortDir,
} from "../../shared/common/constants";
import {
  STATISTICS_EXCEPTION_KEYS,
  STATISTICS_EXCEPTION_SEVERITIES,
  STATISTICS_EXCEPTION_SORT_FIELDS,
  StatisticsExceptionKey,
  StatisticsExceptionSeverity,
  StatisticsExceptionSortField,
} from "../statistics.constants";
import { StatisticsPaginatedFiltersQueryDto } from "./statistics-filters.query.dto";

export class StatisticsExceptionsQueryDto extends StatisticsPaginatedFiltersQueryDto {
  @ApiPropertyOptional({ enum: STATISTICS_EXCEPTION_KEYS })
  @IsOptional()
  @IsIn(STATISTICS_EXCEPTION_KEYS)
  key?: StatisticsExceptionKey;

  @ApiPropertyOptional({ enum: STATISTICS_EXCEPTION_SEVERITIES })
  @IsOptional()
  @IsIn(STATISTICS_EXCEPTION_SEVERITIES)
  severity?: StatisticsExceptionSeverity;

  @ApiPropertyOptional({
    enum: STATISTICS_EXCEPTION_SORT_FIELDS,
    default: "severity",
  })
  @IsOptional()
  @IsIn(STATISTICS_EXCEPTION_SORT_FIELDS)
  sortBy?: StatisticsExceptionSortField = "severity";

  @ApiPropertyOptional({ enum: SORT_DIR_VALUES, default: "desc" })
  @IsOptional()
  @IsIn(SORT_DIR_VALUES)
  sortDir?: SortDir = "desc";
}

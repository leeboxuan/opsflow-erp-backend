import { PickType } from "@nestjs/swagger";
import { StatisticsFiltersQueryDto } from "./statistics-filters.query.dto";

/**
 * Finance remains at job grain in V1, so driver, vehicle, and trip filters are
 * intentionally absent rather than silently applying ambiguous any-trip
 * semantics.
 */
export class StatisticsFinanceQueryDto extends PickType(
  StatisticsFiltersQueryDto,
  ["from", "to", "customerId", "jobId"] as const,
) {}

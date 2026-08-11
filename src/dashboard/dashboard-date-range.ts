import { BadRequestException } from "@nestjs/common";
import { getSafeTenantTimezone } from "../shared/common/tenant-timezone";
import {
  resolveStatisticsDateRange,
  type StatisticsDateRange,
} from "../statistics/statistics-date-range";

export type DashboardDateRangeInput = {
  from?: string;
  to?: string;
};

function hasDateParam(value?: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Tenant-local calendar day as YYYY-MM-DD (same Intl approach as Statistics). */
export function getTenantLocalTodayKey(
  timeZone: string,
  now = new Date(),
): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

/**
 * Dashboard date bounds: both omitted → Today; both set → inclusive calendar
 * range via resolveStatisticsDateRange; exactly one set → validation error.
 */
export function resolveDashboardDateRange(
  input: DashboardDateRangeInput,
  tenantTimeZone?: string | null,
  now = new Date(),
): StatisticsDateRange {
  const hasFrom = hasDateParam(input.from);
  const hasTo = hasDateParam(input.to);
  if (hasFrom !== hasTo) {
    throw new BadRequestException(
      "from and to must both be provided or both omitted",
    );
  }

  const timeZone = getSafeTenantTimezone(tenantTimeZone);

  if (!hasFrom && !hasTo) {
    const today = getTenantLocalTodayKey(timeZone, now);
    return resolveStatisticsDateRange(
      { from: today, to: today },
      timeZone,
      now,
    );
  }

  return resolveStatisticsDateRange(
    { from: input.from!.trim(), to: input.to!.trim() },
    timeZone,
    now,
  );
}

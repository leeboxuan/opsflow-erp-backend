import { BadRequestException } from "@nestjs/common";
import {
  getSafeTenantTimezone,
  zonedDateTimeToUtc,
} from "../transport/drivers/driver-trip-earnings.helpers";

export const DEFAULT_STATISTICS_DATE_RANGE_DAYS = 30;

export type StatisticsDateRange = {
  from: string;
  to: string;
  gte: Date;
  lt: Date;
  timeZone: string;
};

type DateParts = {
  year: number;
  month: number;
  day: number;
};

function parseDateOnly(value: string, field: "from" | "to"): DateParts {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new BadRequestException(`${field} must be YYYY-MM-DD`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new BadRequestException(`${field} must be a valid date`);
  }
  return { year, month, day };
}

function formatDateOnly(parts: DateParts): string {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function addCalendarDays(parts: DateParts, days: number): DateParts {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function localDateParts(now: Date, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

/**
 * Resolves inclusive tenant-local date inputs to an inclusive-start,
 * exclusive-end UTC range through the existing canonical timezone converter.
 */
export function resolveStatisticsDateRange(
  input: { from?: string; to?: string },
  tenantTimeZone?: string | null,
  now = new Date(),
): StatisticsDateRange {
  const timeZone = getSafeTenantTimezone(tenantTimeZone);
  const today = localDateParts(now, timeZone);
  const toParts = input.to ? parseDateOnly(input.to, "to") : today;
  const fromParts = input.from
    ? parseDateOnly(input.from, "from")
    : addCalendarDays(toParts, -(DEFAULT_STATISTICS_DATE_RANGE_DAYS - 1));
  const from = formatDateOnly(fromParts);
  const to = formatDateOnly(toParts);
  if (from > to) {
    throw new BadRequestException("to must be on or after from");
  }
  const afterTo = addCalendarDays(toParts, 1);

  return {
    from,
    to,
    gte: zonedDateTimeToUtc(
      fromParts.year,
      fromParts.month,
      fromParts.day,
      0,
      0,
      0,
      timeZone,
    ),
    lt: zonedDateTimeToUtc(
      afterTo.year,
      afterTo.month,
      afterTo.day,
      0,
      0,
      0,
      timeZone,
    ),
    timeZone,
  };
}

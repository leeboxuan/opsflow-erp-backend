import { getSafeTenantTimezone } from "../../shared/common/tenant-timezone";
import { getDateKeyInTimeZone } from "../driver-app/driver-trip-schedule.helpers";

/**
 * Offset (ms) such that: utcInstant = Date.UTC(y,m,d,h,mi,s) - offset
 * for wall-clock time in `timeZone`.
 */
function timezoneOffsetMsAt(utcInstant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(utcInstant);
  const map = new Map(parts.map((p) => [p.type, p.value] as const));
  const asUtc = Date.UTC(
    Number(map.get("year")),
    Number(map.get("month")) - 1,
    Number(map.get("day")),
    Number(map.get("hour")),
    Number(map.get("minute")),
    Number(map.get("second")),
  );
  return asUtc - utcInstant.getTime();
}

function wallTimeToUtc(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, h, mi, s));
  const offset = timezoneOffsetMsAt(guess, timeZone);
  let utc = new Date(Date.UTC(y, m - 1, d, h, mi, s) - offset);
  // One refinement pass for DST edges.
  const offset2 = timezoneOffsetMsAt(utc, timeZone);
  utc = new Date(Date.UTC(y, m - 1, d, h, mi, s) - offset2);
  return utc;
}

/**
 * Phase 5 — operating-day bounds in the tenant IANA timezone.
 * Returns half-open [dayStart, dayEnd) covering YYYY-MM-DD in that zone.
 */
export function tenantOperatingDayBounds(
  dateYmd: string,
  timezoneInput?: string | null,
): { dayStart: Date; dayEnd: Date; timezone: string; date: string } {
  const timezone = getSafeTenantTimezone(timezoneInput);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    throw new Error(`Invalid operating date: ${dateYmd}`);
  }
  const [y, m, d] = dateYmd.split("-").map(Number);
  const dayStart = wallTimeToUtc(y, m, d, 0, 0, 0, timezone);
  // Next civil day (month overflow handled by Date.UTC).
  const next = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
  const nextKey = getDateKeyInTimeZone(next, timezone);
  const [ny, nm, nd] = nextKey.split("-").map(Number);
  const dayEnd = wallTimeToUtc(ny, nm, nd, 0, 0, 0, timezone);
  return { dayStart, dayEnd, timezone, date: dateYmd };
}

export function dateKeyInTenantTimezone(
  value: Date | null | undefined,
  timezoneInput?: string | null,
): string | null {
  if (!value) return null;
  return getDateKeyInTimeZone(value, getSafeTenantTimezone(timezoneInput));
}

/** Today (YYYY-MM-DD) in the tenant timezone. */
export function todayOperatingDate(timezoneInput?: string | null): string {
  return getDateKeyInTimeZone(new Date(), getSafeTenantTimezone(timezoneInput));
}

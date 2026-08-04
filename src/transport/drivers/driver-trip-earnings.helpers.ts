import { BadRequestException } from "@nestjs/common";

export const DEFAULT_TENANT_TIMEZONE = "Asia/Singapore";
export const DEFAULT_DRIVER_EARNING_CURRENCY = "SGD";

/** Driver payout total for mobile cards: persisted cents, else sum of payout lines. */
export function resolveDriverTripEarningCents(trip: {
  driverEarningCents?: number | null;
  payoutLines?: Array<{ totalCents?: number | null }> | null;
}): number | null {
  if (Number.isInteger(trip.driverEarningCents)) {
    return trip.driverEarningCents as number;
  }
  const lines = trip.payoutLines ?? [];
  if (!lines.length) return null;
  const total = lines.reduce((sum, line) => sum + (line.totalCents ?? 0), 0);
  return total > 0 ? total : null;
}

export function getSafeTenantTimezone(value?: string | null): string {
  const timezone = value?.trim() || DEFAULT_TENANT_TIMEZONE;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TENANT_TIMEZONE;
  }
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const map = new Map(parts.map((p) => [p.type, p.value] as const));
  const asUtc = Date.UTC(
    Number(map.get("year")),
    Number(map.get("month")) - 1,
    Number(map.get("day")),
    Number(map.get("hour")),
    Number(map.get("minute")),
    Number(map.get("second")),
  );
  return asUtc - date.getTime();
}

export function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset);
}

/** Inclusive-exclusive UTC range for a calendar month in a tenant IANA time zone. */
export function parseCalendarMonthToUtcRangeInTimeZone(
  monthStr: string,
  timeZone: string,
): { gte: Date; lt: Date } {
  const m = String(monthStr ?? "").trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new BadRequestException("month must be YYYY-MM");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!mo || mo < 1 || mo > 12) {
    throw new BadRequestException("month must be YYYY-MM");
  }
  const gte = zonedDateTimeToUtc(y, mo, 1, 0, 0, 0, timeZone);
  let ny = y;
  let nm = mo + 1;
  if (nm === 13) {
    nm = 1;
    ny += 1;
  }
  const lt = zonedDateTimeToUtc(ny, nm, 1, 0, 0, 0, timeZone);
  return { gte, lt };
}

/** Current calendar month key (YYYY-MM) in the given IANA time zone. */
export function getCurrentMonthKeyInTimeZone(timeZone: string, now = new Date()): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  });
  const parts = dtf.formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  if (!year || !month) {
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
  }
  return `${year}-${month}`;
}

export type DriverWalletSummaryTripRow = {
  tripId: string;
  jobId: string | null;
  jobInternalRef: string | null;
  title: string | null;
  completedAt: Date | null;
  driverEarningCents: number;
  earningLabelSnapshot: string | null;
  status: string;
};

export type DriverWalletSummaryByMonth = {
  month: string;
  totalCents: number;
  completedTripCount: number;
  trips: DriverWalletSummaryTripRow[];
};

export function mapTripsToWalletSummaryRows(
  trips: Array<{
    id: string;
    jobId: string | null;
    title: string | null;
    status: string;
    closedAt: Date | null;
    updatedAt: Date;
    driverEarningCents: number | null;
    earningLabelSnapshot: string | null;
    payoutLines: Array<{ totalCents?: number | null }> | null;
    job: { internalRef: string | null } | null;
  }>,
): DriverWalletSummaryTripRow[] {
  return trips.map((trip) => {
    const earning = resolveDriverTripEarningCents(trip);
    return {
      tripId: trip.id,
      jobId: trip.jobId ?? null,
      jobInternalRef: trip.job?.internalRef ?? null,
      title: trip.title ?? null,
      completedAt: trip.closedAt ?? trip.updatedAt ?? null,
      // Same as prior mobile mapping: may be null when no payout resolved.
      driverEarningCents: earning as number,
      earningLabelSnapshot: trip.earningLabelSnapshot ?? null,
      status: trip.status,
    };
  });
}

export function sumWalletTripRowsCents(rows: DriverWalletSummaryTripRow[]): number {
  return rows.reduce((sum, row) => sum + (row.driverEarningCents ?? 0), 0);
}

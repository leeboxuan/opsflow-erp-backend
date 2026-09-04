/**
 * Effective scheduled datetime for driver list ordering / start gate:
 * trip.plannedStartAt → job.pickupDate (only when pickup has an explicit time or is legacy) → null.
 * Date-only requested pickup (pickupDateHasTime=false) is not an exact schedule constraint.
 */
export function resolveEffectiveScheduledAt(input: {
  plannedStartAt?: Date | string | null;
  jobPickupDate?: Date | string | null;
  jobPickupDateHasTime?: boolean | null;
}): Date | null {
  const planned = toValidDate(input.plannedStartAt);
  if (planned) return planned;
  if (input.jobPickupDateHasTime === false) return null;
  return toValidDate(input.jobPickupDate);
}

export function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type SchedulableTripSortRow = {
  id: string;
  plannedStartAt?: Date | string | null;
  jobPickupDate?: Date | string | null;
  jobPickupDateHasTime?: boolean | null;
  tripSequence?: number | null;
  jobSequence?: number | null;
  createdAt?: Date | string | null;
};

/**
 * Primary: effective scheduled datetime ascending (nulls last).
 * Tie-breakers: trip/job sequence, createdAt, id.
 */
export function compareTripsByEffectiveSchedule(
  a: SchedulableTripSortRow,
  b: SchedulableTripSortRow,
): number {
  const aAt = resolveEffectiveScheduledAt({
    plannedStartAt: a.plannedStartAt,
    jobPickupDate: a.jobPickupDate,
    jobPickupDateHasTime: a.jobPickupDateHasTime,
  });
  const bAt = resolveEffectiveScheduledAt({
    plannedStartAt: b.plannedStartAt,
    jobPickupDate: b.jobPickupDate,
    jobPickupDateHasTime: b.jobPickupDateHasTime,
  });
  const aMs = aAt?.getTime() ?? null;
  const bMs = bAt?.getTime() ?? null;
  if (aMs == null && bMs != null) return 1;
  if (aMs != null && bMs == null) return -1;
  if (aMs != null && bMs != null && aMs !== bMs) return aMs - bMs;

  const aSeq = a.tripSequence ?? a.jobSequence ?? null;
  const bSeq = b.tripSequence ?? b.jobSequence ?? null;
  if (aSeq != null && bSeq != null && aSeq !== bSeq) return aSeq - bSeq;
  if (aSeq != null && bSeq == null) return -1;
  if (aSeq == null && bSeq != null) return 1;

  const aCreated = toValidDate(a.createdAt)?.getTime() ?? 0;
  const bCreated = toValidDate(b.createdAt)?.getTime() ?? 0;
  if (aCreated !== bCreated) return aCreated - bCreated;

  return String(a.id).localeCompare(String(b.id));
}

/** YYYY-MM-DD in an IANA time zone. */
export function getDateKeyInTimeZone(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map = new Map(parts.map((p) => [p.type, p.value] as const));
  return `${map.get("year")}-${map.get("month")}-${map.get("day")}`;
}

/** Format YYYY-MM-DD as "17 July 2026" for driver-facing errors. */
export function formatCalendarDayKeyLong(dayKey: string): string {
  const m = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dayKey;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utc = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  return utc.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Resolve the scheduled calendar day for start-trip gating:
 * Trip.plannedStartAt first, else Job.pickupDate when it carries an explicit time (or legacy null hasTime).
 * Date-only requested pickup does not create a start-day constraint.
 */
export function resolveTripScheduledDayKey(input: {
  plannedStartAt?: Date | string | null;
  jobPickupDate?: Date | string | null;
  jobPickupDateHasTime?: boolean | null;
  timeZone: string;
}): string | null {
  const effective = resolveEffectiveScheduledAt({
    plannedStartAt: input.plannedStartAt,
    jobPickupDate: input.jobPickupDate,
    jobPickupDateHasTime: input.jobPickupDateHasTime,
  });
  if (!effective) return null;
  return getDateKeyInTimeZone(effective, input.timeZone);
}

export type TripStartDateGateResult =
  | { allowed: true }
  | { allowed: false; reason: "too_early" | "too_late"; scheduledDayKey: string };

/**
 * A trip may only be started on its scheduled local calendar day (tenant TZ).
 * Completion is intentionally not gated by this helper.
 */
export function evaluateTripStartDateGate(input: {
  plannedStartAt?: Date | string | null;
  jobPickupDate?: Date | string | null;
  jobPickupDateHasTime?: boolean | null;
  now?: Date;
  timeZone: string;
}): TripStartDateGateResult {
  const scheduledDayKey = resolveTripScheduledDayKey(input);
  if (!scheduledDayKey) {
    return { allowed: true };
  }
  const now = input.now ?? new Date();
  const todayKey = getDateKeyInTimeZone(now, input.timeZone);
  if (todayKey === scheduledDayKey) {
    return { allowed: true };
  }
  if (todayKey < scheduledDayKey) {
    return { allowed: false, reason: "too_early", scheduledDayKey };
  }
  return { allowed: false, reason: "too_late", scheduledDayKey };
}

export function tripStartDateGateErrorMessage(
  result: Extract<TripStartDateGateResult, { allowed: false }>,
): string {
  const formatted = formatCalendarDayKeyLong(result.scheduledDayKey);
  if (result.reason === "too_early") {
    return `This trip is scheduled for ${formatted} and cannot be started yet.`;
  }
  return `This trip was scheduled for ${formatted} and can no longer be started.`;
}

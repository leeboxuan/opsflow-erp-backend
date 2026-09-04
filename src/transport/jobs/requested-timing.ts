/**
 * Requested customer pickup/delivery timing — date-only vs date+time.
 * Never treat midnight as a date-only sentinel for legacy rows.
 */

export type RequestedTimingLocal = string | null;

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function isRequestedDateOnlyLocal(value: string | null | undefined): boolean {
  return DATE_ONLY_RE.test(String(value ?? "").trim());
}

export function isRequestedDateTimeLocal(value: string | null | undefined): boolean {
  return DATE_TIME_RE.test(String(value ?? "").trim());
}

export function requestedLocalHasTime(value: string | null | undefined): boolean {
  return isRequestedDateTimeLocal(value);
}

/** Human display for review/UI: `4 Sep 2026 · Time not specified` or with clock time. */
export function formatRequestedTimingDisplay(local: string | null | undefined): string | null {
  const raw = String(local ?? "").trim();
  if (!raw) return null;

  const dateOnly = DATE_ONLY_RE.exec(raw);
  if (dateOnly) {
    const day = Number(dateOnly[3]);
    const month = Number(dateOnly[2]);
    const year = Number(dateOnly[1]);
    return `${day} ${SHORT_MONTHS[month - 1]} ${year} · Time not specified`;
  }

  const dt = DATE_TIME_RE.exec(raw);
  if (!dt) return raw;

  const year = Number(dt[1]);
  const month = Number(dt[2]);
  const day = Number(dt[3]);
  const hour = Number(dt[4]);
  const minute = Number(dt[5]);
  const hour12 = ((hour + 11) % 12) + 1;
  const ampm = hour >= 12 ? "PM" : "AM";
  const mm = String(minute).padStart(2, "0");
  return `${day} ${SHORT_MONTHS[month - 1]} ${year}, ${hour12}:${mm} ${ampm}`;
}

function tzParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** Convert wall-clock `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` in `timeZone` to UTC. */
export function zonedRequestedLocalToUtc(local: string, timeZone: string): Date {
  const trimmed = local.trim();
  const dateOnly = DATE_ONLY_RE.exec(trimmed);
  const asDateTime = dateOnly
    ? `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00`
    : trimmed;
  const m = DATE_TIME_RE.exec(asDateTime);
  if (!m) return new Date(trimmed);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i += 1) {
    const got = tzParts(new Date(utc), timeZone);
    const gotUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute);
    const desired = Date.UTC(year, month - 1, day, hour, minute);
    const delta = desired - gotUtc;
    if (delta === 0) break;
    utc += delta;
  }
  return new Date(utc);
}

export function ymdInTimezone(date: Date, timeZone: string): string {
  const parts = tzParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function hmInTimezone(date: Date, timeZone: string): string {
  const parts = tzParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * Rebuild form/local value from persisted job fields.
 * Legacy `hasTime === null` keeps full datetime (including historical midnight).
 */
export function requestedLocalFromPersisted(input: {
  at: Date | string | null | undefined;
  hasTime: boolean | null | undefined;
  timeZone: string;
}): string | null {
  if (input.at == null || input.at === "") return null;
  const date = typeof input.at === "string" ? new Date(input.at) : input.at;
  if (Number.isNaN(date.getTime())) return null;
  const ymd = ymdInTimezone(date, input.timeZone);
  if (input.hasTime === false) return ymd;
  return `${ymd}T${hmInTimezone(date, input.timeZone)}`;
}

export function serializeRequestedTimingForJob(
  local: string | null | undefined,
  timeZone: string,
): { at: string | null; hasTime: boolean | null } {
  const raw = String(local ?? "").trim();
  if (!raw) return { at: null, hasTime: null };
  const at = zonedRequestedLocalToUtc(raw, timeZone);
  return {
    at: at.toISOString(),
    hasTime: requestedLocalHasTime(raw),
  };
}

export function serializeRequestedPickupForJob(
  local: string | null | undefined,
  timeZone: string,
): { pickupDate: string | null; pickupDateHasTime: boolean | null } {
  const serialized = serializeRequestedTimingForJob(local, timeZone);
  return {
    pickupDate: serialized.at,
    pickupDateHasTime: serialized.hasTime,
  };
}

export function serializeRequestedDeliveryForJob(
  local: string | null | undefined,
  timeZone: string,
): { deliveryDate: string | null; deliveryDateHasTime: boolean | null } {
  const serialized = serializeRequestedTimingForJob(local, timeZone);
  return {
    deliveryDate: serialized.at,
    deliveryDateHasTime: serialized.hasTime,
  };
}

export function serializeRequestedStorageRentForJob(
  local: string | null | undefined,
  timeZone: string,
): {
  psaStorageRentLastDay: string | null;
  psaStorageRentLastDayHasTime: boolean | null;
} {
  const serialized = serializeRequestedTimingForJob(local, timeZone);
  return {
    psaStorageRentLastDay: serialized.at,
    psaStorageRentLastDayHasTime: serialized.hasTime,
  };
}

export type RequestedTimingVisibility = {
  showPickup: boolean;
  showDelivery: boolean;
};

/**
 * LCL + IMPORT collect requested delivery only.
 * EXPORT collects requested pickup only.
 * Other types (COLLECTION / RETURN / ONE_WAY / mixed) keep both.
 */
export function requestedTimingVisibility(
  types: Array<string | null | undefined>,
): RequestedTimingVisibility {
  const normalized = [
    ...new Set(
      types
        .map((t) => String(t ?? "").trim().toUpperCase())
        .filter((t) => t.length > 0),
    ),
  ];
  if (normalized.length === 0) {
    return { showPickup: true, showDelivery: true };
  }
  let showPickup = false;
  let showDelivery = false;
  for (const t of normalized) {
    if (t === "IMPORT" || t === "LCL") {
      showDelivery = true;
      continue;
    }
    if (t === "EXPORT") {
      showPickup = true;
      continue;
    }
    showPickup = true;
    showDelivery = true;
  }
  return { showPickup, showDelivery };
}

export function relocateRequestedTimingForVisibility<
  T extends {
    pickupDateLocal?: string | null;
    deliveryDateLocal?: string | null;
    pickupDateDisplay?: string | null;
    deliveryDateDisplay?: string | null;
    pickupDateNeedsReview?: boolean;
    deliveryDateNeedsReview?: boolean;
  },
>(reviewed: T, types: Array<string | null | undefined>): T {
  const vis = requestedTimingVisibility(types);
  const pickupLocal = String(reviewed.pickupDateLocal ?? "").trim();
  const deliveryLocal = String(reviewed.deliveryDateLocal ?? "").trim();
  let next = reviewed;

  if (!vis.showPickup && vis.showDelivery) {
    if (!deliveryLocal && pickupLocal) {
      next = {
        ...next,
        deliveryDateLocal: reviewed.pickupDateLocal ?? null,
        deliveryDateDisplay: reviewed.pickupDateDisplay ?? null,
        deliveryDateNeedsReview: Boolean(reviewed.pickupDateNeedsReview),
      };
    }
    next = {
      ...next,
      pickupDateLocal: null,
      pickupDateDisplay: null,
      pickupDateNeedsReview: false,
    };
  }

  if (!vis.showDelivery && vis.showPickup) {
    if (!pickupLocal && deliveryLocal) {
      next = {
        ...next,
        pickupDateLocal: reviewed.deliveryDateLocal ?? null,
        pickupDateDisplay: reviewed.deliveryDateDisplay ?? null,
        pickupDateNeedsReview: Boolean(reviewed.deliveryDateNeedsReview),
      };
    }
    next = {
      ...next,
      deliveryDateLocal: null,
      deliveryDateDisplay: null,
      deliveryDateNeedsReview: false,
    };
  }

  return next;
}


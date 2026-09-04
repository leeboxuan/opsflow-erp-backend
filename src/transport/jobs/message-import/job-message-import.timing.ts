import {
  formatRequestedTimingDisplay,
  zonedRequestedLocalToUtc,
} from "../requested-timing";

export type OperationalTimingParseInput = {
  text: string | null | undefined;
  /** Parse-time anchor for relative phrases such as "today" / "tomorrow" (YYYY-MM-DD, tenant timezone). */
  referenceDate: string;
  timezone: string;
};
export type OperationalTimingParseResult = {
  locationHint: string | null;
  /** YYYY-MM-DD (date-only), YYYY-MM-DDTHH:mm (date+time), or null (unset). */
  pickupDateLocal: string | null;
  deliveryDateLocal: string | null;
  display: string | null;
  needsReview: boolean;
  reason: string | null;
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const LOCATION_HINTS = new Set([
  "PSA",
  "CFS",
  "CY",
  "POD",
  "PPZ",
  "LCL",
  "FCL",
]);

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function localDateTime(year: number, month: number, day: number, hour: number, minute: number): string {
  return `${ymd(year, month, day)}T${pad2(hour)}:${pad2(minute)}`;
}

function parseReferenceDate(referenceDate: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(referenceDate.trim());
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Wall-clock today in an IANA timezone as YYYY-MM-DD (parse anchor only). */
export function todayYmdInTimezone(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function addDays(base: { year: number; month: number; day: number }, days: number) {
  const utc = Date.UTC(base.year, base.month - 1, base.day + days);
  const d = new Date(utc);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function formatDisplay(local: string): string {
  return formatRequestedTimingDisplay(local) ?? local;
}

function parseTimeToken(raw: string): { hour: number; minute: number } | "ambiguous" | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;

  const hm = /^(\d{1,2}):(\d{2})(am|pm)?$/.exec(t);
  if (hm) {
    let hour = Number(hm[1]);
    const minute = Number(hm[2]);
    const ap = hm[3];
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }

  const ampm = /^(\d{1,2})(am|pm)$/.exec(t);
  if (ampm) {
    let hour = Number(ampm[1]);
    if (hour > 12) return null;
    if (ampm[2] === "pm" && hour < 12) hour += 12;
    if (ampm[2] === "am" && hour === 12) hour = 0;
    return { hour, minute: 0 };
  }

  if (/^\d{3,4}$/.test(t)) {
    const padded = t.padStart(4, "0");
    const hour = Number(padded.slice(0, 2));
    const minute = Number(padded.slice(2, 4));
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }

  return null;
}

function parseDayMonth(raw: string, year: number): { year: number; month: number; day: number } | null {
  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(raw);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    let y = year;
    if (slash[3]) {
      y = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { year: y, month, day };
  }

  const named = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?$/i.exec(raw);
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2].toLowerCase()];
    if (!month || day < 1 || day > 31) return null;
    const y = named[3] ? Number(named[3]) : year;
    return { year: y, month, day };
  }

  return null;
}

function extractLocationHint(text: string): string | null {
  const tokens = text.split(/[\s,;/|-]+/).filter(Boolean);
  for (const token of tokens) {
    const upper = token.replace(/[^A-Za-z]/g, "").toUpperCase();
    if (LOCATION_HINTS.has(upper)) return upper;
  }
  return null;
}

/**
 * Parse operational timing shorthand into a reviewable local datetime.
 * Ambiguous windows/deadlines are flagged and never silently guessed.
 */
export function parseOperationalTiming(
  input: OperationalTimingParseInput,
): OperationalTimingParseResult {
  const empty: OperationalTimingParseResult = {
    locationHint: null,
    pickupDateLocal: null,
    deliveryDateLocal: null,
    display: null,
    needsReview: false,
    reason: null,
  };
  const raw = (input.text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return empty;

  const reference = parseReferenceDate(input.referenceDate);
  if (!reference) {
    return { ...empty, needsReview: true, reason: "Reference date is invalid." };
  }

  const locationHint = extractLocationHint(raw);
  const lower = raw.toLowerCase();

  // Detention / vessel ETA are operational metadata, not requested pickup/delivery times.
  // Do not invent requested timing unless the message/user explicitly establishes that meaning.
  if (/\bdet(?:ention)?\b/.test(lower)) {
    return {
      ...empty,
      locationHint,
      needsReview: false,
      reason: "Detention date is not a requested pickup time.",
      display: null,
    };
  }
  if (/\beta\b/.test(lower)) {
    return {
      ...empty,
      locationHint,
      needsReview: false,
      reason: "Vessel ETA is not a requested pickup time.",
      display: null,
    };
  }

  if (/\bbefore\b/.test(lower) || /\bafter\b/.test(lower)) {
    return {
      ...empty,
      locationHint,
      needsReview: true,
      reason: "Time is a constraint, not an exact pickup time.",
      display: `${raw} — Needs review`,
    };
  }

  if (
    /\b\d{1,2}\s*(?:-|–|to)\s*\d{1,2}(?:\s*(?:am|pm))?\b/i.test(lower) ||
    /\b\d{3,4}\s*-\s*\d{3,4}\b/.test(lower)
  ) {
    return {
      ...empty,
      locationHint,
      needsReview: true,
      reason: "Time window is ambiguous.",
      display: `${raw} — Needs review`,
    };
  }

  let date = { ...reference };
  let time: { hour: number; minute: number } | null = null;
  let sawRelative = false;

  if (/\btomorrow\b/.test(lower)) {
    date = addDays(reference, 1);
    sawRelative = true;
  } else if (/\btoday\b/.test(lower)) {
    sawRelative = true;
  }

  const dateCandidates = [
    ...raw.matchAll(
      /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+\d{4})?)/g,
    ),
  ].map((m) => m[1]);

  if (dateCandidates.length > 1) {
    return {
      ...empty,
      locationHint,
      needsReview: true,
      reason: "Multiple dates found.",
      display: `${raw} — Needs review`,
    };
  }
  if (dateCandidates.length === 1) {
    const parsedDate = parseDayMonth(dateCandidates[0], reference.year);
    if (!parsedDate) {
      return {
        ...empty,
        locationHint,
        needsReview: true,
        reason: "Date could not be resolved.",
        display: `${raw} — Needs review`,
      };
    }
    date = parsedDate;
  }

  const dateCandidateText = (dateCandidates[0] ?? "").toLowerCase();
  const timeCandidates = [
    ...raw.matchAll(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)|\d{3,4})\b/gi),
  ]
    .map((m) => m[1])
    .filter((token) => {
      const compact = token.replace(/\s+/g, "").toLowerCase();
      if (/^\d{1,2}\/\d{1,2}/.test(compact)) return false;
      // Years in named dates ("12th August 2026") must not be read as 20:26.
      if (/^(?:19|20)\d{2}$/.test(compact)) return false;
      if (dateCandidateText && dateCandidateText.includes(compact)) return false;
      return true;
    });

  const parsedTimes = timeCandidates
    .map(parseTimeToken)
    .filter((t): t is { hour: number; minute: number } => !!t && t !== "ambiguous");

  if (parsedTimes.length > 1) {
    return {
      ...empty,
      locationHint,
      needsReview: true,
      reason: "Multiple times found.",
      display: `${raw} — Needs review`,
    };
  }
  if (parsedTimes.length === 1) time = parsedTimes[0];

  const hasExplicitDate = dateCandidates.length === 1 || sawRelative;
  if (!hasExplicitDate && !time) {
    return empty;
  }

  if (!time) {
    const dateOnly = ymd(date.year, date.month, date.day);
    return {
      locationHint,
      // Date-only requested timing is valid — do not invent midnight or block confirm.
      pickupDateLocal: dateOnly,
      deliveryDateLocal: null,
      display: formatRequestedTimingDisplay(dateOnly),
      needsReview: false,
      reason: null,
    };
  }

  const pickupDateLocal = localDateTime(date.year, date.month, date.day, time.hour, time.minute);
  return {
    locationHint,
    pickupDateLocal,
    deliveryDateLocal: null,
    display: formatDisplay(pickupDateLocal),
    needsReview: false,
    reason: null,
  };
}

/** Convert a wall-clock `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` in `timeZone` to a UTC Date. */
export function zonedLocalDateTimeToUtc(local: string, timeZone: string): Date {
  return zonedRequestedLocalToUtc(local, timeZone);
}

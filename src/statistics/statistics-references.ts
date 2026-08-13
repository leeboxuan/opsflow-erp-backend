import { JobType, TripStatus } from "@prisma/client";

export function displayPersonName(
  name: string | null | undefined,
  fallback: string | null | undefined = null,
): string | null {
  const primary = typeof name === "string" ? name.trim() : "";
  if (primary) return primary;
  const secondary = typeof fallback === "string" ? fallback.trim() : "";
  return secondary || null;
}

export function displayContainerNo(
  itemCode: string | null | undefined,
  snapshot: string | null | undefined,
): string {
  const code = typeof itemCode === "string" ? itemCode.trim() : "";
  if (code) return code;
  const cached = typeof snapshot === "string" ? snapshot.trim() : "";
  return cached || "—";
}

export function displayJobNo(internalRef: string | null | undefined): string {
  const value = typeof internalRef === "string" ? internalRef.trim() : "";
  return value || "—";
}

export function displayTripReference(input: {
  jobNo: string | null | undefined;
  jobSequence: number | null | undefined;
  tripSequence: number | null | undefined;
}): string {
  const jobNo = displayJobNo(input.jobNo);
  const sequence =
    input.jobSequence != null
      ? input.jobSequence
      : input.tripSequence != null
        ? input.tripSequence
        : null;
  if (jobNo === "—") {
    return sequence != null ? `Trip ${sequence}` : "Trip";
  }
  return sequence != null ? `${jobNo} · Trip ${sequence}` : jobNo;
}

export function displayLaneEndpoint(
  label: string | null | undefined,
  role: "origin" | "destination",
): string {
  const value = typeof label === "string" ? label.trim() : "";
  if (value) return value;
  return role === "origin" ? "Unspecified origin" : "Unspecified destination";
}

export function displayLaneName(
  originLabel: string | null | undefined,
  destinationLabel: string | null | undefined,
): string {
  return `${displayLaneEndpoint(originLabel, "origin")} → ${displayLaneEndpoint(destinationLabel, "destination")}`;
}

export function displayVehiclePlate(
  fleetPlate: string | null | undefined,
  vehiclePlate: string | null | undefined,
  acceptedVehicleNo: string | null | undefined,
): string {
  for (const candidate of [fleetPlate, vehiclePlate, acceptedVehicleNo]) {
    const value = typeof candidate === "string" ? candidate.trim() : "";
    if (value) return value;
  }
  return "Unassigned";
}

export function displayTrailerNo(
  trailerNumber: string | null | undefined,
  acceptedTrailerNo: string | null | undefined,
): string | null {
  for (const candidate of [trailerNumber, acceptedTrailerNo]) {
    const value = typeof candidate === "string" ? candidate.trim() : "";
    if (value) return value;
  }
  return null;
}

export function displayJobType(jobType: JobType | string | null | undefined): string {
  if (!jobType) return "—";
  return String(jobType);
}

export function displayTripStatus(status: TripStatus | string | null | undefined): string {
  if (!status) return "—";
  if (status === TripStatus.DONE) return "Completed";
  if (status === TripStatus.COMPLETED) return "Completed";
  const text = String(status).toLowerCase().replaceAll("_", " ");
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Best-effort container size/type from JobItem.description.
 * JobItem has no dedicated size field; unrecognised text is kept as recorded.
 */
export function inferContainerSizeLabel(
  description: string | null | undefined,
): string {
  const raw = typeof description === "string" ? description.trim() : "";
  if (!raw) return "Unspecified";
  const compact = raw.toUpperCase().replace(/[\s-]+/g, "");
  if (/^20(')?(FT)?$/.test(compact) || compact === "20GP" || compact === "20G") {
    return "20'";
  }
  if (
    compact.startsWith("40HC") ||
    compact === "40HQ" ||
    compact === "40HIGH" ||
    compact === "40HCHIGH" ||
    compact === "40HIGHCUBE"
  ) {
    return "40HC";
  }
  if (/^40(')?(FT)?$/.test(compact) || compact === "40GP" || compact === "40G") {
    return "40'";
  }
  return raw;
}

export function calendarDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatDurationMsForReport(
  durationMs: number | null | undefined,
): string | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export function durationMsToExcelDayFraction(
  durationMs: number | null | undefined,
): number | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }
  return durationMs / 86_400_000;
}

export function centsToMajorUnits(cents: number | null | undefined): number | null {
  if (cents == null || !Number.isSafeInteger(cents)) return null;
  return cents / 100;
}

export function basisPointsToRatio(
  basisPoints: number | null | undefined,
): number | null {
  if (basisPoints == null || !Number.isSafeInteger(basisPoints)) return null;
  return basisPoints / 10_000;
}

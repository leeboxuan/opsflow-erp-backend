import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export const DEFAULT_TENANT_TIMEZONE = "Asia/Singapore";
export const HISTORY_MAX_DISPLAY_POINTS = 3000;
export const DEFAULT_STOP_MINUTES = 10;
export const DEFAULT_STOP_RADIUS_METERS = 50;
export const LOW_SPEED_KPH = 3;
export const MINIMAL_MOVEMENT_METERS = 10;

export interface ValidHistoryPoint {
  id: string;
  recordedAt: Date;
  lat: number;
  lng: number;
  speedKph: number | null;
  heading: number | null;
}

export interface ChassisHistorySummaryValues {
  pointCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  distanceKm: number | null;
  maxSpeedKph: number | null;
  avgSpeedKph: number | null;
  stopCount: number;
  stoppedTimeSeconds: number;
}

export interface StopDetectionOptions {
  stopMinutes?: number;
  stopRadiusMeters?: number;
}

export interface DetectedHistoryStop {
  id: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  lat: number;
  lng: number;
  pointCount: number;
  maxRadiusMeters: number;
}

export function decimalToNumber(value: Prisma.Decimal | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
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

function zonedDateTimeToUtc(
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

export function parseCalendarDateToUtcRangeInTimeZone(
  dateStr: string,
  timeZone: string,
): { gte: Date; lt: Date } {
  const m = String(dateStr ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new BadRequestException("date must be YYYY-MM-DD");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!mo || mo < 1 || mo > 12 || !d || d < 1 || d > 31) {
    throw new BadRequestException("date must be YYYY-MM-DD");
  }
  const gte = zonedDateTimeToUtc(y, mo, d, 0, 0, 0, timeZone);
  const lt = zonedDateTimeToUtc(y, mo, d + 1, 0, 0, 0, timeZone);
  return { gte, lt };
}

export function isValidCoordinate(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  return haversineKm(lat1, lng1, lat2, lng2) * 1000;
}

function computeCentroid(points: ValidHistoryPoint[]): { lat: number; lng: number } {
  const count = points.length;
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / count;
  const lng = points.reduce((sum, p) => sum + p.lng, 0) / count;
  return { lat, lng };
}

function maxDistanceFromCentroidMeters(
  points: ValidHistoryPoint[],
  centroid: { lat: number; lng: number },
): number {
  let max = 0;
  for (const point of points) {
    max = Math.max(
      max,
      haversineMeters(centroid.lat, centroid.lng, point.lat, point.lng),
    );
  }
  return max;
}

function isStagnantCandidate(
  point: ValidHistoryPoint,
  previous: ValidHistoryPoint | null,
): boolean {
  if (point.speedKph !== null && point.speedKph <= LOW_SPEED_KPH) return true;
  if (previous) {
    const movementMeters = haversineMeters(
      previous.lat,
      previous.lng,
      point.lat,
      point.lng,
    );
    if (movementMeters < MINIMAL_MOVEMENT_METERS) return true;
  }
  return false;
}

export function detectHistoryStops(
  points: ValidHistoryPoint[],
  options: StopDetectionOptions = {},
): DetectedHistoryStop[] {
  const stopMinutes = options.stopMinutes ?? DEFAULT_STOP_MINUTES;
  const stopRadiusMeters = options.stopRadiusMeters ?? DEFAULT_STOP_RADIUS_METERS;
  const minDurationSeconds = stopMinutes * 60;

  if (points.length < 2) return [];

  const stops: DetectedHistoryStop[] = [];
  let index = 0;
  let stopIndex = 0;

  while (index < points.length) {
    const previous = index > 0 ? points[index - 1] : null;
    if (!isStagnantCandidate(points[index], previous)) {
      index++;
      continue;
    }

    const cluster: ValidHistoryPoint[] = [points[index]];
    let nextIndex = index + 1;
    const anchor = points[index];

    while (nextIndex < points.length) {
      const candidate = points[nextIndex];
      if (
        haversineMeters(anchor.lat, anchor.lng, candidate.lat, candidate.lng) >
        stopRadiusMeters
      ) {
        break;
      }
      cluster.push(candidate);
      nextIndex++;
    }

    const startedAt = cluster[0].recordedAt;
    const endedAt = cluster[cluster.length - 1].recordedAt;
    const durationSeconds = Math.max(
      0,
      Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000),
    );

    if (durationSeconds >= minDurationSeconds) {
      const centroid = computeCentroid(cluster);
      stopIndex += 1;
      stops.push({
        id: `stop-${stopIndex}`,
        startedAt,
        endedAt,
        durationSeconds,
        lat: Math.round(centroid.lat * 1e7) / 1e7,
        lng: Math.round(centroid.lng * 1e7) / 1e7,
        pointCount: cluster.length,
        maxRadiusMeters: Math.round(maxDistanceFromCentroidMeters(cluster, centroid) * 10) / 10,
      });
    }

    index = nextIndex > index + 1 ? nextIndex : index + 1;
  }

  return stops;
}

export function computeDistanceKm(points: ValidHistoryPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    total += haversineKm(prev.lat, prev.lng, curr.lat, curr.lng);
  }
  return total;
}

export function computeHistorySummary(
  points: ValidHistoryPoint[],
  stops: DetectedHistoryStop[] = [],
): ChassisHistorySummaryValues {
  if (points.length === 0) {
    return {
      pointCount: 0,
      firstSeenAt: null,
      lastSeenAt: null,
      distanceKm: null,
      maxSpeedKph: null,
      avgSpeedKph: null,
      stopCount: 0,
      stoppedTimeSeconds: 0,
    };
  }

  const speeds = points
    .map((p) => p.speedKph)
    .filter((s): s is number => s !== null && s !== undefined);
  const distanceKm = computeDistanceKm(points);

  return {
    pointCount: points.length,
    firstSeenAt: points[0].recordedAt.toISOString(),
    lastSeenAt: points[points.length - 1].recordedAt.toISOString(),
    distanceKm: Math.round(distanceKm * 1000) / 1000,
    maxSpeedKph: speeds.length ? Math.max(...speeds) : null,
    avgSpeedKph: speeds.length
      ? Math.round((speeds.reduce((a, b) => a + b, 0) / speeds.length) * 100) / 100
      : null,
    stopCount: stops.length,
    stoppedTimeSeconds: stops.reduce((sum, stop) => sum + stop.durationSeconds, 0),
  };
}

export function downsampleHistoryPoints<T>(
  points: T[],
  maxPoints = HISTORY_MAX_DISPLAY_POINTS,
): T[] {
  if (points.length <= maxPoints) return points;

  const sampled: T[] = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(points[Math.round(i * step)]);
  }
  return sampled;
}

import { DEFAULT_TENANT_TIMEZONE, getSafeTenantTimezone } from "../../shared/common/tenant-timezone";

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}

export type LorryChitVehicleLike = {
  plateNo?: string | null;
} | null;

export type LorryChitTruckSource = {
  tripFleetPlate?: string | null;
  tripVehiclePlate?: string | null;
  driverFleetPlate?: string | null;
  driverVehiclePlate?: string | null;
  acceptedVehicleNo?: string | null;
};

/** Driver's assigned vehicle first, then trip assignment, then legacy accepted plate. */
export function resolveLorryChitTruckNumber(source: LorryChitTruckSource): string | null {
  return firstNonEmpty(
    source.driverFleetPlate,
    source.driverVehiclePlate,
    source.tripFleetPlate,
    source.tripVehiclePlate,
    source.acceptedVehicleNo,
  );
}

/** Lorry Chit date line: today in the tenant timezone (DD/MM/YYYY). */
export function formatLorryChitDateLabel(
  now: Date = new Date(),
  timeZone: string | null | undefined = DEFAULT_TENANT_TIMEZONE,
): string {
  const tz = getSafeTenantTimezone(timeZone);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(now);
  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const year = parts.find((part) => part.type === "year")?.value;
  if (!day || !month || !year) {
    return now.toLocaleDateString("en-SG", { timeZone: tz });
  }
  return `${day}/${month}/${year}`;
}

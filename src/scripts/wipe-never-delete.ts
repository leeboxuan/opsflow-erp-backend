/**
 * Tables / domains that operational wipe must NEVER delete.
 *
 * GPS / fleet-tracking data is permanently excluded from wipe scope:
 * positions/history, tracker/device records, tracker–chassis/vehicle associations,
 * and fleet-tracking config/history.
 *
 * Keep this list explicit so future wipe edits fail closed in unit tests.
 * Do not run wipe from CI or agent workflows against production.
 */

export const WIPE_NEVER_DELETE_TABLES = [
  // GPS positions & device history
  "gps_positions",
  "GpsPosition",
  "gps_devices",
  "GpsDevice",
  // Chassis / vehicle tracker associations (fleet tracking config)
  "chassis",
  "Chassis",
  "fleet_vehicles",
  "FleetVehicle",
  "vehicles",
  "Vehicle",
] as const;

export type WipeNeverDeleteTable = (typeof WIPE_NEVER_DELETE_TABLES)[number];

/** Prisma client property names that wipe must never call deleteMany on. */
export const WIPE_NEVER_DELETE_PRISMA_MODELS = [
  "gpsPosition",
  "gpsDevice",
  "chassis",
  "fleetVehicle",
  "vehicle",
] as const;

/**
 * Assert a wipe deletion-key set does not include GPS / fleet-tracking models.
 * Used by unit tests; wipe script should not reference these keys.
 */
export function assertWipeDoesNotTargetGps(
  deletionKeys: Iterable<string>,
): void {
  const forbidden = new Set<string>([
    ...WIPE_NEVER_DELETE_PRISMA_MODELS,
    ...WIPE_NEVER_DELETE_TABLES,
  ]);
  const hits: string[] = [];
  for (const key of deletionKeys) {
    if (forbidden.has(key)) hits.push(key);
    // Also catch common typos / aliases
    const lower = key.toLowerCase();
    if (
      lower.includes("gps") ||
      lower === "chassis" ||
      lower.includes("fleetvehicle") ||
      lower.includes("fleet_vehicle")
    ) {
      if (!hits.includes(key)) hits.push(key);
    }
  }
  if (hits.length > 0) {
    throw new Error(
      `Wipe must never delete GPS/fleet-tracking data. Forbidden keys: ${hits.join(", ")}`,
    );
  }
}

import {
  WIPE_NEVER_DELETE_PRISMA_MODELS,
  WIPE_NEVER_DELETE_TABLES,
  assertWipeDoesNotTargetGps,
} from "./wipe-never-delete";

/**
 * Keys currently written by scripts/wipe-operational-data.ts into deletionCounts.
 * Keep in sync when adding wipe steps — GPS/fleet must never appear here.
 */
const OPERATIONAL_WIPE_DELETION_KEYS = [
  "notificationRecipient",
  "notification",
  "invoiceLineItem_byInvoice",
  "transportOrder_invoiceId_nulled",
  "invoiceLineItem_byTrip",
  "customerCompanyDocument",
  "invoice",
  "auditLog",
  "eventLog",
  "tripJobItem",
  "tripDocumentRequirement",
  "tripPayoutLine",
  "tripDocument",
  "driverWalletTransaction",
  "jobCharge",
  "jobItem",
  "jobDocument",
  "driver_wallet_entries",
  "trip",
  "job",
  "job_internal_ref_counters",
  "podPhotoDocument",
] as const;

describe("wipe GPS / fleet-tracking exclusion", () => {
  it("documents permanent GPS exclusion tables", () => {
    expect(WIPE_NEVER_DELETE_TABLES).toEqual(
      expect.arrayContaining([
        "gps_positions",
        "gps_devices",
        "GpsPosition",
        "GpsDevice",
        "chassis",
        "fleet_vehicles",
      ]),
    );
    expect(WIPE_NEVER_DELETE_PRISMA_MODELS).toEqual(
      expect.arrayContaining([
        "gpsPosition",
        "gpsDevice",
        "chassis",
        "fleetVehicle",
      ]),
    );
  });

  it("operational wipe deletion keys never target GPS or fleet trackers", () => {
    expect(() =>
      assertWipeDoesNotTargetGps(OPERATIONAL_WIPE_DELETION_KEYS),
    ).not.toThrow();
  });

  it("assertWipeDoesNotTargetGps rejects gps/fleet keys", () => {
    expect(() => assertWipeDoesNotTargetGps(["job", "gpsDevice"])).toThrow(
      /Gps|gps/i,
    );
    expect(() => assertWipeDoesNotTargetGps(["chassis"])).toThrow(/chassis/i);
    expect(() => assertWipeDoesNotTargetGps(["fleetVehicle"])).toThrow(
      /fleet/i,
    );
  });
});

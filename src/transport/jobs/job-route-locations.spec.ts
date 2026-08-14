import { JobTripTemplate, JobType } from "@prisma/client";
import {
  assertCanonicalRouteLocationsForCreate,
  canonicalAutoTripRouteSnapshots,
  resolveCanonicalRouteLocations,
} from "./job-route-locations";

describe("canonical route locations", () => {
  it("EXPORT maps depot, customer, and port without duplicating the return depot", () => {
    const locations = resolveCanonicalRouteLocations({
      jobType: JobType.EXPORT,
      pickupAddress1: "PSA Empty Depot",
      deliveryAddress1: "Nat Test Company",
      receiverName: "Daniel",
      exportDetails: {
        exportPortAddress1: "PSA Pasir Panjang Terminal",
      },
    });
    expect(locations.depot?.address1).toBe("PSA Empty Depot");
    expect(locations.customer?.address1).toBe("Nat Test Company");
    expect(locations.port?.address1).toBe("PSA Pasir Panjang Terminal");
    const snaps = canonicalAutoTripRouteSnapshots(JobType.EXPORT, locations);
    expect(snaps[JobTripTemplate.DEPOT_TO_DELIVERY]?.originAddressLine1).toBe(
      "PSA Empty Depot",
    );
    expect(snaps[JobTripTemplate.PORT_TO_DEPOT]?.destinationAddressLine1).toBe(
      "PSA Empty Depot",
    );
    expect(snaps[JobTripTemplate.PORT_TO_DEPOT]?.originAddressLine1).toBe(
      "PSA Pasir Panjang Terminal",
    );
  });

  it("rejects EXPORT without export port using an operational message", () => {
    const locations = resolveCanonicalRouteLocations({
      jobType: JobType.EXPORT,
      pickupAddress1: "Depot",
      deliveryAddress1: "Customer",
    });
    expect(() =>
      assertCanonicalRouteLocationsForCreate(JobType.EXPORT, locations),
    ).toThrow(/Export port \/ terminal is required/);
  });

  it("IMPORT requires return depot", () => {
    const locations = resolveCanonicalRouteLocations({
      jobType: JobType.IMPORT,
      pickupAddress1: "Jurong Port",
      deliveryAddress1: "Customer",
    });
    expect(() =>
      assertCanonicalRouteLocationsForCreate(JobType.IMPORT, locations),
    ).toThrow(/Empty container return depot is required/);
  });
});

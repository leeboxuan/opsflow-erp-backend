import { JobTripTemplate, JobType } from "@prisma/client";
import {
  assertCanonicalRouteLocationsForCreate,
  canonicalAutoTripRouteSnapshots,
  resolveCanonicalRouteLocations,
} from "./job-route-locations";

describe("canonical route locations", () => {
  it("EXPORT maps customer and port; optional depot stays reference-only", () => {
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
    expect(Object.keys(snaps)).toEqual([JobTripTemplate.DELIVERY_TO_PORT]);
    expect(snaps[JobTripTemplate.DELIVERY_TO_PORT]?.originAddressLine1).toBe(
      "Nat Test Company",
    );
    expect(snaps[JobTripTemplate.DELIVERY_TO_PORT]?.destinationAddressLine1).toBe(
      "PSA Pasir Panjang Terminal",
    );
    expect(snaps[JobTripTemplate.DELIVERY_TO_PORT]?.tripPICName).toBe("Daniel");
    expect(snaps[JobTripTemplate.DEPOT_TO_DELIVERY]).toBeUndefined();
    expect(snaps[JobTripTemplate.PORT_TO_DEPOT]).toBeUndefined();
  });

  it("allows EXPORT without empty-container depot", () => {
    const locations = resolveCanonicalRouteLocations({
      jobType: JobType.EXPORT,
      deliveryAddress1: "Customer",
      exportDetails: { exportPortAddress1: "PSA Terminal" },
    });
    expect(() =>
      assertCanonicalRouteLocationsForCreate(JobType.EXPORT, locations),
    ).not.toThrow();
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

  it("IMPORT requires return depot unless pending is allowed", () => {
    const locations = resolveCanonicalRouteLocations({
      jobType: JobType.IMPORT,
      pickupAddress1: "Jurong Port",
      deliveryAddress1: "Customer",
    });
    expect(() =>
      assertCanonicalRouteLocationsForCreate(JobType.IMPORT, locations),
    ).toThrow(/Empty container return depot is required/);
    expect(() =>
      assertCanonicalRouteLocationsForCreate(JobType.IMPORT, locations, {
        allowPendingReturnDepot: true,
      }),
    ).not.toThrow();
  });

  it("ONE_WAY maps pickup → delivery as a single Trip snapshot", () => {
    const locations = resolveCanonicalRouteLocations({
      jobType: JobType.ONE_WAY,
      pickupAddress1: "Yard A",
      deliveryAddress1: "Yard B",
      receiverName: "Ops",
    });
    expect(() =>
      assertCanonicalRouteLocationsForCreate(JobType.ONE_WAY, locations),
    ).not.toThrow();
    const snaps = canonicalAutoTripRouteSnapshots(JobType.ONE_WAY, locations);
    expect(Object.keys(snaps)).toEqual([JobTripTemplate.PICKUP_TO_DELIVERY]);
    expect(snaps[JobTripTemplate.PICKUP_TO_DELIVERY]?.originAddressLine1).toBe(
      "Yard A",
    );
    expect(
      snaps[JobTripTemplate.PICKUP_TO_DELIVERY]?.destinationAddressLine1,
    ).toBe("Yard B");
  });

  it("RETURN maps pickup → depot as a single Trip snapshot", () => {
    const locations = resolveCanonicalRouteLocations({
      jobType: JobType.RETURN,
      pickupAddress1: "Customer Yard",
      importDetails: {
        returningDepotAddress1: "Cogent",
        returningDepotCode: "COGENT",
      },
    });
    expect(() =>
      assertCanonicalRouteLocationsForCreate(JobType.RETURN, locations),
    ).not.toThrow();
    const snaps = canonicalAutoTripRouteSnapshots(JobType.RETURN, locations);
    expect(Object.keys(snaps)).toEqual([JobTripTemplate.PICKUP_TO_DELIVERY]);
    expect(snaps[JobTripTemplate.PICKUP_TO_DELIVERY]?.originAddressLine1).toBe(
      "Customer Yard",
    );
    expect(
      snaps[JobTripTemplate.PICKUP_TO_DELIVERY]?.destinationAddressLine1,
    ).toBe("Cogent");
  });

  it("rejects RETURN without depot", () => {
    const locations = resolveCanonicalRouteLocations({
      jobType: JobType.RETURN,
      pickupAddress1: "Customer Yard",
    });
    expect(() =>
      assertCanonicalRouteLocationsForCreate(JobType.RETURN, locations),
    ).toThrow(/Return depot is required/);
  });

  it("allows RETURN draft intake when depot is explicitly pending", () => {
    const locations = resolveCanonicalRouteLocations({
      jobType: JobType.RETURN,
      pickupAddress1: "Customer Yard",
    });
    expect(() =>
      assertCanonicalRouteLocationsForCreate(JobType.RETURN, locations, {
        allowPendingReturnDepot: true,
      }),
    ).not.toThrow();
    const snaps = canonicalAutoTripRouteSnapshots(JobType.RETURN, locations);
    expect(
      snaps[JobTripTemplate.PICKUP_TO_DELIVERY]?.destinationAddressLine1 ?? null,
    ).toBeNull();
  });

  it("does not let allowPendingReturnDepot waive COLLECTION delivery", () => {
    const locations = resolveCanonicalRouteLocations({
      jobType: JobType.COLLECTION,
      pickupAddress1: "30 Pioneer Sector 2",
    });
    expect(() =>
      assertCanonicalRouteLocationsForCreate(JobType.COLLECTION, locations, {
        allowPendingReturnDepot: true,
      }),
    ).toThrow(/Delivery location is required/);
  });
});

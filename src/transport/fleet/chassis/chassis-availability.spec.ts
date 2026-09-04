import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  assertChassisAvailableForCheckout,
  classifyChassisAvailability,
} from "./chassis-availability";

describe("chassis availability", () => {
  const chassis = {
    id: "c1",
    tenantId: "t1",
    chassisNo: "TR1",
    status: "ACTIVE",
    isBorrowed: false,
    borrowedFromCompany: null,
  };

  it("marks inactive chassis unavailable", () => {
    expect(
      classifyChassisAvailability({
        chassis: { status: "INACTIVE" },
        activeCheckoutTripId: null,
      }),
    ).toEqual({
      availability: "INACTIVE",
      selectable: false,
      currentTripId: null,
    });
  });

  it("allows current trip to retain checked-out chassis", () => {
    expect(
      classifyChassisAvailability({
        chassis: { status: "ACTIVE" },
        activeCheckoutTripId: "trip-1",
        forTripId: "trip-1",
      }),
    ).toEqual({
      availability: "CHECKED_OUT",
      selectable: true,
      currentTripId: "trip-1",
    });
  });

  it("disables chassis checked out by another trip", () => {
    expect(
      classifyChassisAvailability({
        chassis: { status: "ACTIVE" },
        activeCheckoutTripId: "trip-other",
        forTripId: "trip-1",
      }),
    ).toEqual({
      availability: "CHECKED_OUT",
      selectable: false,
      currentTripId: "trip-other",
    });
  });

  it("rejects cross-tenant or missing chassis", () => {
    expect(() =>
      assertChassisAvailableForCheckout({
        chassis: { ...chassis, tenantId: "other" },
        tenantId: "t1",
        chassisId: "c1",
        forTripId: "trip-1",
        conflictingTripId: null,
      }),
    ).toThrow(NotFoundException);
  });

  it("rejects concurrent checkout on another trip", () => {
    expect(() =>
      assertChassisAvailableForCheckout({
        chassis,
        tenantId: "t1",
        chassisId: "c1",
        forTripId: "trip-1",
        conflictingTripId: "trip-2",
      }),
    ).toThrow(BadRequestException);
  });

  it("accepts available tenant chassis", () => {
    expect(
      assertChassisAvailableForCheckout({
        chassis,
        tenantId: "t1",
        chassisId: "c1",
        forTripId: "trip-1",
        conflictingTripId: null,
      }),
    ).toEqual(chassis);
  });
});

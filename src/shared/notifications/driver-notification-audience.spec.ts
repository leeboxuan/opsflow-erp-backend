import { Role, TripStatus } from "@prisma/client";
import { shouldNotifyAssignedDriver } from "./driver-notification-audience";

describe("shouldNotifyAssignedDriver", () => {
  const assigned = "driver-1";

  it("returns false when no assigned driver", () => {
    expect(
      shouldNotifyAssignedDriver({
        actorUserId: "ops-1",
        actorRole: Role.TRANSPORT_STAFF,
        assignedDriverUserId: null,
        tripStatus: TripStatus.PUBLISHED,
        isDriverVisibleEvent: true,
      }),
    ).toBe(false);
  });

  it("returns false when actor is the assigned driver", () => {
    expect(
      shouldNotifyAssignedDriver({
        actorUserId: assigned,
        actorRole: Role.DRIVER,
        assignedDriverUserId: assigned,
        tripStatus: TripStatus.PUBLISHED,
        isDriverVisibleEvent: true,
      }),
    ).toBe(false);
  });

  it("returns false when actor role is DRIVER (even if different user)", () => {
    expect(
      shouldNotifyAssignedDriver({
        actorUserId: "other-driver",
        actorRole: Role.DRIVER,
        assignedDriverUserId: assigned,
        tripStatus: TripStatus.PUBLISHED,
        isDriverVisibleEvent: true,
      }),
    ).toBe(false);
  });

  it("returns false for DRAFT trips unless allowUnpublishedTrip", () => {
    expect(
      shouldNotifyAssignedDriver({
        actorUserId: "ops-1",
        actorRole: Role.TRANSPORT_STAFF,
        assignedDriverUserId: assigned,
        tripStatus: TripStatus.DRAFT,
        isDriverVisibleEvent: true,
      }),
    ).toBe(false);
    expect(
      shouldNotifyAssignedDriver({
        actorUserId: "ops-1",
        actorRole: Role.TRANSPORT_STAFF,
        assignedDriverUserId: assigned,
        tripStatus: TripStatus.DRAFT,
        isDriverVisibleEvent: true,
        allowUnpublishedTrip: true,
      }),
    ).toBe(true);
  });

  it("returns true when ops updates a published assigned trip", () => {
    expect(
      shouldNotifyAssignedDriver({
        actorUserId: "ops-1",
        actorRole: Role.TRANSPORT_STAFF,
        assignedDriverUserId: assigned,
        tripStatus: TripStatus.PUBLISHED,
        isDriverVisibleEvent: true,
      }),
    ).toBe(true);
  });
});

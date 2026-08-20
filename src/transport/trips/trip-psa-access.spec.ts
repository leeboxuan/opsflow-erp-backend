import { ConflictException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";
import {
  assertPsaAssignmentAllowed,
  DRIVER_PSA_ACCESS_REQUIRED,
  DRIVER_PSA_ACCESS_REMOVAL_CONFLICT,
  driverHasPsaPortAccess,
  evaluatePsaEligibilityConflict,
  isPsaAssignmentAllowed,
  psaPublishBlockReason,
  throwPsaAccessRemovalConflict,
  tripRequiresPsaPortAccess,
} from "./trip-psa-access";

describe("trip-psa-access", () => {
  it("defaults false — no requirement allows any driver", () => {
    expect(isPsaAssignmentAllowed({})).toBe(true);
    expect(
      isPsaAssignmentAllowed({
        requiresPsaPortAccess: false,
        hasPsaPortAccess: false,
      }),
    ).toBe(true);
  });

  it("eligible assignment succeeds", () => {
    expect(
      isPsaAssignmentAllowed({
        requiresPsaPortAccess: true,
        hasPsaPortAccess: true,
      }),
    ).toBe(true);
    expect(() =>
      assertPsaAssignmentAllowed({
        requiresPsaPortAccess: true,
        hasPsaPortAccess: true,
        tripId: "t1",
        driverUserId: "d1",
      }),
    ).not.toThrow();
  });

  it("ineligible assignment throws 409 DRIVER_PSA_ACCESS_REQUIRED", () => {
    try {
      assertPsaAssignmentAllowed({
        requiresPsaPortAccess: true,
        hasPsaPortAccess: false,
        tripId: "t1",
        driverUserId: "d1",
      });
      fail("expected ConflictException");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      const body = (err as ConflictException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body.code).toBe(DRIVER_PSA_ACCESS_REQUIRED);
      expect(body.tripId).toBe("t1");
      expect(body.driverUserId).toBe("d1");
    }
  });

  it("does not infer PSA from job/trip type alone", () => {
    expect(tripRequiresPsaPortAccess(undefined)).toBe(false);
    expect(driverHasPsaPortAccess(undefined)).toBe(false);
    expect(
      isPsaAssignmentAllowed({
        requiresPsaPortAccess: false,
        hasPsaPortAccess: false,
      }),
    ).toBe(true);
  });

  it("DRAFT conflict blocks publish; published/ongoing is urgent without lifecycle mutation", () => {
    const draft = evaluatePsaEligibilityConflict({
      requiresPsaPortAccess: true,
      hasPsaPortAccess: false,
      status: TripStatus.DRAFT,
      assignedDriverUserId: "d1",
    });
    expect(draft.hasConflict).toBe(true);
    expect(draft.severity).toBe("BLOCK_PUBLISH");

    const ongoing = evaluatePsaEligibilityConflict({
      requiresPsaPortAccess: true,
      hasPsaPortAccess: false,
      status: TripStatus.ONGOING,
      assignedDriverUserId: "d1",
    });
    expect(ongoing.hasConflict).toBe(true);
    expect(ongoing.severity).toBe("URGENT");

    expect(
      psaPublishBlockReason({
        requiresPsaPortAccess: true,
        hasPsaPortAccess: false,
        assignedDriverUserId: "d1",
      }),
    ).toMatch(/Reassign before publishing/);
  });

  it("unassigned trip has no conflict", () => {
    const c = evaluatePsaEligibilityConflict({
      requiresPsaPortAccess: true,
      hasPsaPortAccess: false,
      status: TripStatus.DRAFT,
    });
    expect(c.hasConflict).toBe(false);
  });

  it("access-removal confirmation conflict payload", () => {
    try {
      throwPsaAccessRemovalConflict({
        driverUserId: "d1",
        conflictingTrips: [
          {
            tripId: "t1",
            jobId: "j1",
            status: TripStatus.PUBLISHED,
            plannedStartAt: null,
          },
        ],
      });
      fail("expected ConflictException");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      const body = (err as ConflictException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body.code).toBe(DRIVER_PSA_ACCESS_REMOVAL_CONFLICT);
      expect(body.confirmRequired).toBe(true);
      expect(Array.isArray(body.conflictingTrips)).toBe(true);
    }
  });
});

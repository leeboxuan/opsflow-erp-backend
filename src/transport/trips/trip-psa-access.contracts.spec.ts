import { ConflictException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";
import {
  assertPsaAssignmentAllowed,
  DRIVER_PSA_ACCESS_REQUIRED,
  evaluatePsaEligibilityConflict,
  psaPublishBlockReason,
} from "./trip-psa-access";

/**
 * Integration-shaped coverage for assignment/publish PSA gates
 * (pure helpers used by TransportJobsService / Dispatch / TripService).
 */
describe("PSA assignment path contracts", () => {
  it("cross-tenant fail-closed: missing driver profile treated as no access", () => {
    expect(() =>
      assertPsaAssignmentAllowed({
        requiresPsaPortAccess: true,
        hasPsaPortAccess: undefined,
        tripId: "t-cross",
        driverUserId: "foreign-driver",
      }),
    ).toThrow(ConflictException);
  });

  it("default false rows never invent eligibility", () => {
    expect(
      psaPublishBlockReason({
        requiresPsaPortAccess: false,
        hasPsaPortAccess: false,
        assignedDriverUserId: "d1",
      }),
    ).toBeNull();
  });

  it("publish blocked for invalid DRAFT assignment without lifecycle mutation", () => {
    const conflict = evaluatePsaEligibilityConflict({
      requiresPsaPortAccess: true,
      hasPsaPortAccess: false,
      status: TripStatus.DRAFT,
      assignedDriverUserId: "d1",
    });
    expect(conflict.severity).toBe("BLOCK_PUBLISH");
    expect(conflict.code).toBe(DRIVER_PSA_ACCESS_REQUIRED);
    // Caller must not cancel/unassign — helper only reports.
    expect(conflict.hasConflict).toBe(true);
  });

  it("published/ongoing conflict is URGENT and does not imply cancel", () => {
    for (const status of [TripStatus.PUBLISHED, TripStatus.ONGOING]) {
      const conflict = evaluatePsaEligibilityConflict({
        requiresPsaPortAccess: true,
        hasPsaPortAccess: false,
        status,
        assignedDriverUserId: "d1",
      });
      expect(conflict.severity).toBe("URGENT");
    }
  });
});

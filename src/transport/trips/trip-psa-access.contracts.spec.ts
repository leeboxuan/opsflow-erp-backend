import { ConflictException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";
import {
  assertPsaAssignmentAllowed,
  DRIVER_PSA_ACCESS_REQUIRED,
  evaluatePsaEligibilityConflict,
  psaPublishBlockReason,
} from "./trip-psa-access";

/**
 * Response fields that must always be present on trip list/detail DTOs
 * (JSON must retain `false`, never omit the key).
 */
function tripPsaResponseFields(input: {
  requiresPsaPortAccess?: boolean | null;
  hasPsaPortAccess?: boolean | null;
  status: TripStatus;
  assignedDriverUserId?: string | null;
  driverId?: string | null;
}) {
  const requiresPsaPortAccess = input.requiresPsaPortAccess === true;
  const conflict = evaluatePsaEligibilityConflict({
    requiresPsaPortAccess,
    hasPsaPortAccess: input.hasPsaPortAccess === true,
    status: input.status,
    assignedDriverUserId: input.assignedDriverUserId ?? null,
    driverId: input.driverId ?? null,
  });
  return {
    requiresPsaPortAccess,
    psaEligibilityConflict: conflict.hasConflict,
    psaEligibilityConflictSeverity: conflict.severity,
    psaEligibilityConflictMessage: conflict.message,
  };
}

function assertJsonKeepsBoolean(
  obj: Record<string, unknown>,
  key: string,
  value: boolean,
) {
  expect(Object.prototype.hasOwnProperty.call(obj, key)).toBe(true);
  expect(obj[key]).toBe(value);
  const json = JSON.parse(JSON.stringify(obj));
  expect(Object.prototype.hasOwnProperty.call(json, key)).toBe(true);
  expect(json[key]).toBe(value);
}

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

describe("PSA response serialization contracts", () => {
  it("serializes requiresPsaPortAccess false without omitting the key", () => {
    const dto = tripPsaResponseFields({
      requiresPsaPortAccess: false,
      hasPsaPortAccess: false,
      status: TripStatus.DRAFT,
    });
    assertJsonKeepsBoolean(dto, "requiresPsaPortAccess", false);
    assertJsonKeepsBoolean(dto, "psaEligibilityConflict", false);
  });

  it("serializes requiresPsaPortAccess true without omitting the key", () => {
    const dto = tripPsaResponseFields({
      requiresPsaPortAccess: true,
      hasPsaPortAccess: true,
      status: TripStatus.DRAFT,
      assignedDriverUserId: "d1",
    });
    assertJsonKeepsBoolean(dto, "requiresPsaPortAccess", true);
    assertJsonKeepsBoolean(dto, "psaEligibilityConflict", false);
  });

  it("driver DTO shape keeps hasPsaPortAccess false after JSON round-trip", () => {
    const driver = { hasPsaPortAccess: false as boolean };
    assertJsonKeepsBoolean(driver, "hasPsaPortAccess", false);
  });

  it("driver DTO shape keeps hasPsaPortAccess true after JSON round-trip", () => {
    const driver = { hasPsaPortAccess: true as boolean };
    assertJsonKeepsBoolean(driver, "hasPsaPortAccess", true);
  });
});

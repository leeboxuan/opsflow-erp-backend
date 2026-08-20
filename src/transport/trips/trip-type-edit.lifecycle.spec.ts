import { TripStatus } from "@prisma/client";
import {
  assertTripTypeBelongsToJob,
  assertTripTypeEditableStatus,
  TRIP_TYPE_EDIT_LOCKED_CODE,
  TRIP_TYPE_NOT_IN_JOB_CODE,
} from "../jobs/job-types";

function expectFailCode(
  result: { ok: true } | { ok: false; code: string; message?: string },
  code: string,
) {
  expect(result.ok).toBe(false);
  expect((result as { ok: false; code: string }).code).toBe(code);
}

describe("tripType edit lifecycle (Phase 4)", () => {
  it("allows DRAFT only", () => {
    expect(assertTripTypeEditableStatus(TripStatus.DRAFT).ok).toBe(true);
    for (const status of [
      TripStatus.PUBLISHED,
      TripStatus.ONGOING,
      TripStatus.COMPLETED,
      TripStatus.DONE,
      TripStatus.CANCELLED,
    ]) {
      expectFailCode(
        assertTripTypeEditableStatus(status),
        TRIP_TYPE_EDIT_LOCKED_CODE,
      );
    }
  });

  it("requires membership in parent job types (cross-type rejected)", () => {
    expectFailCode(
      assertTripTypeBelongsToJob("EXPORT", ["IMPORT", "COLLECTION"]),
      TRIP_TYPE_NOT_IN_JOB_CODE,
    );
  });

  it("accepts type that belongs to parent", () => {
    expect(
      assertTripTypeBelongsToJob("COLLECTION", ["IMPORT", "COLLECTION"]).ok,
    ).toBe(true);
  });
});

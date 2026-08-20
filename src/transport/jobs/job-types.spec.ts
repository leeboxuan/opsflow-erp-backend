import { JobType } from "@prisma/client";
import {
  assertJobTypeCombinationSupported,
  assertNoDuplicateJobTypesInput,
  assertTripTypeBelongsToJob,
  assertTripTypeEditableStatus,
  autoTripTopologyJobType,
  sharedRouteTopologyJobType,
  cargoModeForJobTypes,
  compatibilityJobTypeOrNull,
  internalRefTypeCode,
  JOB_TYPE_COMBINATION_UNSUPPORTED_CODE,
  JOB_TYPES_CONFLICT_CODE,
  JOB_TYPES_DUPLICATE_CODE,
  JOB_TYPES_REQUIRED_CODE,
  MULTI_TYPE_INTERNAL_REF_SUFFIX,
  normalizeJobTypes,
  resolveCreateJobTypesInput,
  resolveJobTypesForResponse,
  resolveTripTypeForResponse,
  sortJobTypes,
  TRIP_TYPE_EDIT_LOCKED_CODE,
  TRIP_TYPE_NOT_IN_JOB_CODE,
} from "./job-types";

function expectFailCode(
  result: { ok: true } | { ok: false; code: string; message?: string },
  code: string,
) {
  expect(result.ok).toBe(false);
  expect((result as { ok: false; code: string }).code).toBe(code);
}

describe("job-types Phase 4 audit fixes", () => {
  it("normalizes unique types into deterministic order", () => {
    expect(
      normalizeJobTypes(["COLLECTION", "IMPORT", "IMPORT", "EXPORT"]),
    ).toEqual([JobType.EXPORT, JobType.IMPORT, JobType.COLLECTION]);
    expect(sortJobTypes([JobType.LCL, JobType.EXPORT])).toEqual([
      JobType.EXPORT,
      JobType.LCL,
    ]);
  });

  it("rejects exact and case/whitespace duplicates before normalize", () => {
    expect(assertNoDuplicateJobTypesInput(["IMPORT", "IMPORT"]).ok).toBe(false);
    expect(assertNoDuplicateJobTypesInput(["import", " IMPORT "])).toEqual({
      ok: false,
      code: JOB_TYPES_DUPLICATE_CODE,
      message: expect.stringContaining("IMPORT"),
    });
    expect(assertNoDuplicateJobTypesInput(["IMPORT", "COLLECTION"]).ok).toBe(
      true,
    );
    expectFailCode(
      resolveCreateJobTypesInput({ jobTypes: ["IMPORT", "IMPORT"] }),
      JOB_TYPES_DUPLICATE_CODE,
    );
  });

  it("accepts a single-type job via jobTypes with non-null compatibility", () => {
    const r = resolveCreateJobTypesInput({ jobTypes: ["IMPORT"] });
    expect(r).toEqual({
      ok: true,
      jobTypes: [JobType.IMPORT],
      compatibilityJobType: JobType.IMPORT,
    });
  });

  it("accepts IMPORT+COLLECTION without inventing a singular compatibility type", () => {
    const r = resolveCreateJobTypesInput({
      jobTypes: ["COLLECTION", "IMPORT"],
    });
    expect(r.ok && r.jobTypes).toEqual([JobType.IMPORT, JobType.COLLECTION]);
    expect(r.ok && r.compatibilityJobType).toBeNull();
    expect(compatibilityJobTypeOrNull([JobType.IMPORT, JobType.COLLECTION])).toBeNull();
    expect(internalRefTypeCode([JobType.IMPORT, JobType.COLLECTION])).toBe(
      MULTI_TYPE_INTERNAL_REF_SUFFIX,
    );
  });

  it("rejects unsupported combinations with stable code", () => {
    expectFailCode(
      resolveCreateJobTypesInput({ jobTypes: ["IMPORT", "EXPORT"] }),
      JOB_TYPE_COMBINATION_UNSUPPORTED_CODE,
    );
    expect(
      assertJobTypeCombinationSupported([JobType.LCL, JobType.COLLECTION]).ok,
    ).toBe(false);
  });

  it("rejects empty/invalid and conflicting legacy type", () => {
    expect(resolveCreateJobTypesInput({ jobTypes: [] }).ok).toBe(false);
    expect(resolveCreateJobTypesInput({}).ok).toBe(false);
    const inv = resolveCreateJobTypesInput({ jobTypes: ["NOPE"] });
    expect(inv.ok).toBe(false);
    expectFailCode(
      resolveCreateJobTypesInput({
        jobTypes: ["IMPORT", "COLLECTION"],
        jobType: JobType.EXPORT,
      }),
      JOB_TYPES_CONFLICT_CODE,
    );
  });

  it("auto-trip topology only when exactly one type", () => {
    expect(autoTripTopologyJobType([JobType.IMPORT])).toBe(JobType.IMPORT);
    expect(
      autoTripTopologyJobType([JobType.IMPORT, JobType.COLLECTION]),
    ).toBeNull();
  });

  it("shared route topology uses membership not array order", () => {
    expect(
      sharedRouteTopologyJobType([JobType.COLLECTION, JobType.IMPORT]),
    ).toBe(JobType.IMPORT);
    expect(
      sharedRouteTopologyJobType([JobType.COLLECTION, JobType.EXPORT]),
    ).toBe(JobType.EXPORT);
    expect(
      sharedRouteTopologyJobType([JobType.IMPORT, JobType.EXPORT]),
    ).toBeNull();
  });

  it("cargo mode uses membership not first type", () => {
    expect(cargoModeForJobTypes([JobType.IMPORT, JobType.COLLECTION])).toBe(
      "CONTAINER",
    );
    expect(cargoModeForJobTypes([JobType.LCL])).toBe("LCL");
  });

  it("labels LEGACY_FALLBACK vs CANONICAL without inventing multi-type trip type", () => {
    expect(
      resolveJobTypesForResponse({
        assignments: [{ jobType: JobType.EXPORT }],
        legacyJobType: JobType.LCL,
      }),
    ).toEqual({
      jobTypes: [JobType.EXPORT],
      jobTypeSource: "CANONICAL",
    });
    expect(
      resolveTripTypeForResponse({
        tripType: null,
        parentJobTypes: [JobType.IMPORT, JobType.COLLECTION],
        legacyParentJobType: JobType.IMPORT,
      }),
    ).toEqual({ tripType: null, tripTypeSource: "LEGACY_FALLBACK" });
    expect(
      resolveTripTypeForResponse({
        tripType: null,
        parentJobTypes: [JobType.IMPORT],
        legacyParentJobType: JobType.EXPORT,
      }),
    ).toEqual({
      tripType: JobType.IMPORT,
      tripTypeSource: "LEGACY_FALLBACK",
    });
  });

  it("trip type membership and lifecycle lock", () => {
    expectFailCode(
      assertTripTypeBelongsToJob(JobType.EXPORT, [
        JobType.IMPORT,
        JobType.COLLECTION,
      ]),
      TRIP_TYPE_NOT_IN_JOB_CODE,
    );
    expect(assertTripTypeEditableStatus("DRAFT").ok).toBe(true);
    expectFailCode(
      assertTripTypeEditableStatus("PUBLISHED"),
      TRIP_TYPE_EDIT_LOCKED_CODE,
    );
  });

  it("required code still used for empty", () => {
    expectFailCode(
      resolveCreateJobTypesInput({ jobTypes: [] }),
      JOB_TYPES_REQUIRED_CODE,
    );
  });
});

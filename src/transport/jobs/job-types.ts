import { JobType } from "@prisma/client";

/**
 * Phase 4 — multi job types + trip type
 * --------------------------------------
 * Canonical: JobTypeAssignment rows (jobTypes[]). Trip.tripType is exactly one.
 * Compatibility: Job.jobType is nullable. Single-type jobs may keep the singular value;
 * multi-type jobs MUST leave Job.jobType null — never store the first array element.
 *
 * Retirement path: after all clients consume jobTypes/tripType + sources, drop reads of
 * Job.jobType, then remove the column in a later contract migration.
 *
 * Auto-trips: only when exactly one job type is selected.
 * Multi-type: never invent topology from array order; append trips with explicit tripType.
 *
 * Pricing: trip-specific payout/rate decisions use Trip.tripType. Job-level charges are
 * not multiplied by type count.
 *
 * Internal ref suffix for multi-type jobs: MULTI (neutral technical suffix).
 */

export const JOB_TYPE_VALUES = [
  JobType.LCL,
  JobType.IMPORT,
  JobType.EXPORT,
  JobType.COLLECTION,
] as const;

/** Stable display/API order (not request order). */
export const JOB_TYPE_DETERMINISTIC_ORDER: readonly JobType[] = [
  JobType.EXPORT,
  JobType.IMPORT,
  JobType.LCL,
  JobType.COLLECTION,
];

/** Neutral internal-ref type code when a job has multiple canonical types. */
export const MULTI_TYPE_INTERNAL_REF_SUFFIX = "MULTI";

export type TypeProvenanceSource = "CANONICAL" | "LEGACY_FALLBACK";

export const JOB_TYPES_REQUIRED_CODE = "JOB_TYPES_REQUIRED";
export const JOB_TYPES_INVALID_CODE = "JOB_TYPES_INVALID";
export const JOB_TYPES_CONFLICT_CODE = "JOB_TYPES_LEGACY_CONFLICT";
export const JOB_TYPES_DUPLICATE_CODE = "JOB_TYPES_DUPLICATE";
export const JOB_TYPE_COMBINATION_UNSUPPORTED_CODE =
  "JOB_TYPE_COMBINATION_UNSUPPORTED";
export const TRIP_TYPE_REQUIRED_CODE = "TRIP_TYPE_REQUIRED";
export const TRIP_TYPE_NOT_IN_JOB_CODE = "TRIP_TYPE_NOT_IN_JOB";
export const TRIP_TYPE_EDIT_LOCKED_CODE = "TRIP_TYPE_EDIT_LOCKED";
export const JOB_TYPE_IN_USE_BY_TRIP_CODE = "JOB_TYPE_IN_USE_BY_ACTIVE_TRIP";

const ORDER_INDEX = new Map(
  JOB_TYPE_DETERMINISTIC_ORDER.map((t, i) => [t, i]),
);

export function isJobTypeValue(value: unknown): value is JobType {
  return (
    typeof value === "string" &&
    (JOB_TYPE_VALUES as readonly string[]).includes(value)
  );
}

export function sortJobTypes(types: readonly JobType[]): JobType[] {
  return [...types].sort(
    (a, b) => (ORDER_INDEX.get(a) ?? 99) - (ORDER_INDEX.get(b) ?? 99),
  );
}

/**
 * Reject duplicates before set-normalization.
 * Detects exact and case/whitespace-normalized duplicates.
 */
export function assertNoDuplicateJobTypesInput(input: unknown):
  | { ok: true }
  | { ok: false; code: string; message: string } {
  if (input == null) return { ok: true };
  if (!Array.isArray(input)) {
    return {
      ok: false,
      code: JOB_TYPES_INVALID_CODE,
      message: "jobTypes must be an array of JobType values",
    };
  }
  const seen = new Set<string>();
  for (const raw of input) {
    const token = String(raw ?? "")
      .trim()
      .toUpperCase();
    if (!token) continue;
    if (seen.has(token)) {
      return {
        ok: false,
        code: JOB_TYPES_DUPLICATE_CODE,
        message: `Duplicate job type in request: ${token}`,
      };
    }
    seen.add(token);
  }
  return { ok: true };
}

/** Unique canonical values in deterministic order (call only after duplicate check). */
export function normalizeJobTypes(input: unknown): JobType[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<JobType>();
  for (const raw of input) {
    const token = String(raw ?? "")
      .trim()
      .toUpperCase();
    if (!isJobTypeValue(token)) continue;
    seen.add(token);
  }
  return sortJobTypes(Array.from(seen));
}

/**
 * Supported multi-type combinations that share the existing job-level cargo/route shape.
 * Boss operational example: IMPORT + COLLECTION (separate trips per type).
 * EXPORT + COLLECTION is the matching export-side pair.
 * All other mixes (esp. LCL + anything, IMPORT + EXPORT) are rejected.
 */
export function assertJobTypeCombinationSupported(
  jobTypes: readonly JobType[],
):
  | { ok: true }
  | { ok: false; code: string; message: string } {
  const types = sortJobTypes(jobTypes);
  if (types.length <= 1) return { ok: true };

  const key = types.join("+");
  const supported = new Set([
    `${JobType.IMPORT}+${JobType.COLLECTION}`,
    `${JobType.EXPORT}+${JobType.COLLECTION}`,
  ]);
  if (supported.has(key)) return { ok: true };

  return {
    ok: false,
    code: JOB_TYPE_COMBINATION_UNSUPPORTED_CODE,
    message: `Job type combination [${types.join(", ")}] cannot safely share the current job-level cargo/route structure. Supported multi-type combinations: IMPORT+COLLECTION, EXPORT+COLLECTION. Create separate jobs or remove conflicting types.`,
  };
}

/** Compatibility singular: only for single-type jobs; null for multi-type. */
export function compatibilityJobTypeOrNull(
  jobTypes: readonly JobType[],
): JobType | null {
  return jobTypes.length === 1 ? jobTypes[0]! : null;
}

export function internalRefTypeCode(jobTypes: readonly JobType[]): string {
  if (jobTypes.length !== 1) return MULTI_TYPE_INTERNAL_REF_SUFFIX;
  switch (jobTypes[0]) {
    case JobType.LCL:
      return "LCL";
    case JobType.IMPORT:
      return "IMP";
    case JobType.EXPORT:
      return "EXP";
    case JobType.COLLECTION:
      return "COL";
    default:
      return "GEN";
  }
}

export function jobTypesInclude(
  jobTypes: readonly JobType[],
  type: JobType,
): boolean {
  return jobTypes.includes(type);
}

/** Cargo parsing mode from membership — never first-of-array. */
export function cargoModeForJobTypes(
  jobTypes: readonly JobType[],
): "LCL" | "CONTAINER" | "NONE" {
  if (jobTypes.length === 0) return "NONE";
  if (jobTypes.every((t) => t === JobType.LCL)) return "LCL";
  if (
    jobTypes.every(
      (t) =>
        t === JobType.IMPORT ||
        t === JobType.EXPORT ||
        t === JobType.COLLECTION,
    )
  ) {
    return "CONTAINER";
  }
  return "NONE";
}

/**
 * Resolve create/update payload:
 * - Prefer jobTypes when present
 * - Else accept legacy singular jobType / type
 * - Reject duplicates before normalize
 * - If both present and disagree → conflict
 * - Multi-type → compatibilityJobType is null (never invent first type)
 */
export function resolveCreateJobTypesInput(input: {
  jobTypes?: unknown;
  jobType?: unknown;
  type?: unknown;
}):
  | {
      ok: true;
      jobTypes: JobType[];
      /** Null when multi-type — do not classify via Job.jobType. */
      compatibilityJobType: JobType | null;
    }
  | { ok: false; code: string; message: string } {
  const dup = assertNoDuplicateJobTypesInput(input.jobTypes);
  if (dup.ok === false) return dup;

  const fromArray = normalizeJobTypes(input.jobTypes);
  const singularRaw = input.jobType ?? input.type;
  const hasSingular =
    singularRaw != null && String(singularRaw).trim() !== "";
  const singular = hasSingular
    ? String(singularRaw).trim().toUpperCase()
    : null;

  if (input.jobTypes != null && !Array.isArray(input.jobTypes)) {
    return {
      ok: false,
      code: JOB_TYPES_INVALID_CODE,
      message: "jobTypes must be an array of JobType values",
    };
  }

  if (Array.isArray(input.jobTypes)) {
    const invalid = input.jobTypes.filter((v) => {
      const token = String(v ?? "")
        .trim()
        .toUpperCase();
      return token.length > 0 && !isJobTypeValue(token);
    });
    if (invalid.length > 0) {
      return {
        ok: false,
        code: JOB_TYPES_INVALID_CODE,
        message: `Invalid jobTypes: ${invalid.join(", ")}`,
      };
    }
    if (fromArray.length === 0) {
      return {
        ok: false,
        code: JOB_TYPES_REQUIRED_CODE,
        message: "At least one job type is required",
      };
    }
    if (singular && isJobTypeValue(singular) && !fromArray.includes(singular)) {
      return {
        ok: false,
        code: JOB_TYPES_CONFLICT_CODE,
        message:
          "Legacy jobType/type conflicts with jobTypes; send one consistent set",
      };
    }
    if (singular && !isJobTypeValue(singular)) {
      return {
        ok: false,
        code: JOB_TYPES_INVALID_CODE,
        message: `Invalid legacy jobType: ${singular}`,
      };
    }
    const combo = assertJobTypeCombinationSupported(fromArray);
    if (combo.ok === false) return combo;
    return {
      ok: true,
      jobTypes: fromArray,
      compatibilityJobType: compatibilityJobTypeOrNull(fromArray),
    };
  }

  if (singular && isJobTypeValue(singular)) {
    return {
      ok: true,
      jobTypes: [singular],
      compatibilityJobType: singular,
    };
  }
  if (singular) {
    return {
      ok: false,
      code: JOB_TYPES_INVALID_CODE,
      message: `Invalid jobType: ${singular}`,
    };
  }
  return {
    ok: false,
    code: JOB_TYPES_REQUIRED_CODE,
    message: "jobTypes (or legacy jobType) is required",
  };
}

export function resolveJobTypesForResponse(input: {
  assignments?: Array<{ jobType: JobType | string }> | null;
  legacyJobType?: JobType | string | null;
}): { jobTypes: JobType[]; jobTypeSource: TypeProvenanceSource } {
  const fromAssignments = normalizeJobTypes(
    (input.assignments ?? []).map((a) => a.jobType),
  );
  if (fromAssignments.length > 0) {
    return { jobTypes: fromAssignments, jobTypeSource: "CANONICAL" };
  }
  const legacy = String(input.legacyJobType ?? "")
    .trim()
    .toUpperCase();
  if (isJobTypeValue(legacy)) {
    return { jobTypes: [legacy], jobTypeSource: "LEGACY_FALLBACK" };
  }
  return { jobTypes: [], jobTypeSource: "LEGACY_FALLBACK" };
}

export function resolveTripTypeForResponse(input: {
  tripType?: JobType | string | null;
  parentJobTypes?: JobType[];
  legacyParentJobType?: JobType | string | null;
}): { tripType: JobType | null; tripTypeSource: TypeProvenanceSource } {
  const raw = String(input.tripType ?? "")
    .trim()
    .toUpperCase();
  if (isJobTypeValue(raw)) {
    return { tripType: raw, tripTypeSource: "CANONICAL" };
  }
  // Multi-type parent: do not invent a trip type from parent set or singular compat.
  if (input.parentJobTypes && input.parentJobTypes.length !== 1) {
    return { tripType: null, tripTypeSource: "LEGACY_FALLBACK" };
  }
  const parent =
    input.parentJobTypes && input.parentJobTypes.length === 1
      ? input.parentJobTypes[0]!
      : null;
  if (parent) {
    return { tripType: parent, tripTypeSource: "LEGACY_FALLBACK" };
  }
  const legacy = String(input.legacyParentJobType ?? "")
    .trim()
    .toUpperCase();
  if (isJobTypeValue(legacy)) {
    return { tripType: legacy, tripTypeSource: "LEGACY_FALLBACK" };
  }
  return { tripType: null, tripTypeSource: "LEGACY_FALLBACK" };
}

export function assertTripTypeBelongsToJob(
  tripType: unknown,
  jobTypes: readonly JobType[],
):
  | { ok: true; tripType: JobType }
  | { ok: false; code: string; message: string } {
  const token = String(tripType ?? "")
    .trim()
    .toUpperCase();
  if (!token) {
    return {
      ok: false,
      code: TRIP_TYPE_REQUIRED_CODE,
      message: "tripType is required",
    };
  }
  if (!isJobTypeValue(token)) {
    return {
      ok: false,
      code: TRIP_TYPE_REQUIRED_CODE,
      message: `Invalid tripType: ${token}`,
    };
  }
  if (!jobTypes.includes(token)) {
    return {
      ok: false,
      code: TRIP_TYPE_NOT_IN_JOB_CODE,
      message: `tripType ${token} is not one of the job's types (${jobTypes.join(", ")})`,
    };
  }
  return { ok: true, tripType: token };
}

/** Exactly one job type → may drive auto-trip topology; otherwise caller must not invent a type. */
export function autoTripTopologyJobType(
  jobTypes: readonly JobType[],
): JobType | null {
  return jobTypes.length === 1 ? jobTypes[0]! : null;
}

/**
 * Job-level route/cargo topology for supported combinations.
 * IMPORT+COLLECTION / EXPORT+COLLECTION share the IMPORT/EXPORT job-level shape;
 * COLLECTION is expressed via separate trips, not by inventing array-order type.
 * Returns null when no safe shared topology exists (caller must reject or skip).
 */
export function sharedRouteTopologyJobType(
  jobTypes: readonly JobType[],
): JobType | null {
  const types = sortJobTypes(jobTypes);
  if (types.length === 0) return null;
  if (types.length === 1) return types[0]!;
  if (
    types.length === 2 &&
    jobTypesInclude(types, JobType.IMPORT) &&
    jobTypesInclude(types, JobType.COLLECTION)
  ) {
    return JobType.IMPORT;
  }
  if (
    types.length === 2 &&
    jobTypesInclude(types, JobType.EXPORT) &&
    jobTypesInclude(types, JobType.COLLECTION)
  ) {
    return JobType.EXPORT;
  }
  return null;
}

/** Trip type may change only while DRAFT (pre-publish editable state). */
export function assertTripTypeEditableStatus(status: string):
  | { ok: true }
  | { ok: false; code: string; message: string } {
  if (status === "DRAFT") return { ok: true };
  return {
    ok: false,
    code: TRIP_TYPE_EDIT_LOCKED_CODE,
    message: `tripType cannot be changed when trip status is ${status}; only DRAFT trips allow type edits`,
  };
}

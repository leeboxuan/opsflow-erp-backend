import {
  TripDocumentRequirementStage,
  TripDocumentResponsibleUploader,
  TripDocumentType,
  TripStatus,
} from "@prisma/client";
import {
  shouldSkipCompletionSnapshotType,
  type TripDocumentRequirementSnapshot,
} from "./trip-document-requirements";

/** Canonical POD photo type. Legacy OTHER images may satisfy only when image-like. */
export const PHOTO_DOCUMENTATION_SATISFYING_TYPES: string[] = [
  TripDocumentType.POD_PHOTO,
];

export const PHOTO_DOCUMENTATION_MISSING_KEY = TripDocumentType.POD_PHOTO;

const IMAGE_MIME_PREFIX = "image/";
const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".gif",
];

export type TripDocumentEvalInput = {
  type?: string | null;
  isActive?: boolean | null;
  isSigned?: boolean | null;
  signedAt?: Date | string | null;
  generatedBySystem?: boolean | null;
  mimeType?: string | null;
  originalName?: string | null;
  fileName?: string | null;
};

export type TripDocumentRequirementEvaluationSource =
  | "SNAPSHOT"
  | "LEGACY_FALLBACK";

export type TripDocumentRequirementEvalInput = {
  id?: string | null;
  type: TripDocumentType | string;
  label?: string | null;
  isRequired: boolean;
  requiresSignature: boolean;
  minCount?: number | null;
  sortOrder?: number | null;
  responsibleUploader?: TripDocumentResponsibleUploader | string | null;
  requirementStage?: TripDocumentRequirementStage | string | null;
};

export type TripDocumentRequirementSatisfiedState =
  | "SATISFIED"
  | "MISSING"
  | "UNSIGNED"
  | "PARTIAL"
  | "NOT_REQUIRED";

export type TripDocumentBlockingAction =
  | "NONE"
  | "PUBLISH"
  | "START"
  | "COMPLETE";

export type TripDocumentBlockingActor =
  | "NONE"
  | "DRIVER"
  | "OPERATIONS"
  | "EITHER";

export type TripDocumentReadinessStatus =
  | "READY"
  | "MISSING"
  | "BLOCKED_BY_OPERATIONS"
  | "BLOCKED_BY_DRIVER"
  | "UNAVAILABLE";

export type EvaluatedTripDocumentRequirement = {
  requirementId: string | null;
  type: string;
  label: string;
  isRequired: boolean;
  minCount: number;
  satisfiedCount: number;
  missingCount: number;
  requiresSignature: boolean;
  signatureSatisfied: boolean;
  responsibleUploader: TripDocumentResponsibleUploader;
  requirementStage: TripDocumentRequirementStage;
  satisfiedState: TripDocumentRequirementSatisfiedState;
  blockingAction: TripDocumentBlockingAction;
  blockingActor: TripDocumentBlockingActor;
  blocksLifecycle: boolean;
};

export type TripDocumentRequirementEvaluation = {
  tripStatus: string | null;
  cancelled: boolean;
  /** SNAPSHOT when TripDocumentRequirement rows exist; otherwise LEGACY_FALLBACK. */
  evaluationSource: TripDocumentRequirementEvaluationSource;
  requirements: EvaluatedTripDocumentRequirement[];
  totalMissingCount: number;
  readinessStatus: TripDocumentReadinessStatus;
  blockingAction: TripDocumentBlockingAction;
  blockingActor: TripDocumentBlockingActor;
  /** Stable type codes still missing for the given lifecycle stage filter. */
  missingTypeCodes: string[];
  summaryLabels: string[];
};

function normalizeType(type?: string | null): string {
  return String(type ?? "")
    .trim()
    .toUpperCase();
}

function normalizeUploader(
  value?: string | null,
): TripDocumentResponsibleUploader {
  const key = String(value ?? "")
    .trim()
    .toUpperCase();
  if (key === TripDocumentResponsibleUploader.OPERATIONS) {
    return TripDocumentResponsibleUploader.OPERATIONS;
  }
  if (key === TripDocumentResponsibleUploader.EITHER) {
    return TripDocumentResponsibleUploader.EITHER;
  }
  return TripDocumentResponsibleUploader.DRIVER;
}

function normalizeStage(
  value?: string | null,
): TripDocumentRequirementStage {
  const key = String(value ?? "")
    .trim()
    .toUpperCase();
  if (key === TripDocumentRequirementStage.BEFORE_DISPATCH) {
    return TripDocumentRequirementStage.BEFORE_DISPATCH;
  }
  if (key === TripDocumentRequirementStage.BEFORE_START) {
    return TripDocumentRequirementStage.BEFORE_START;
  }
  if (key === TripDocumentRequirementStage.REFERENCE_ONLY) {
    return TripDocumentRequirementStage.REFERENCE_ONLY;
  }
  return TripDocumentRequirementStage.BEFORE_COMPLETE;
}

export function isDocumentCanonicallySigned(
  doc: TripDocumentEvalInput,
): boolean {
  return doc.isSigned === true || doc.signedAt != null;
}

export function isActiveTripDocument(
  doc: TripDocumentEvalInput,
): boolean {
  return doc.isActive !== false;
}

function defaultLabelForType(type: string): string {
  switch (type) {
    case TripDocumentType.DELIVERY_DO:
      return "Delivery DO";
    case TripDocumentType.PICKUP_DO:
      return "Pickup DO";
    case TripDocumentType.POD_PHOTO:
      return "Proof of Delivery Photo";
    case TripDocumentType.PERMIT:
      return "Permit";
    case TripDocumentType.OTHER:
      return "Other document";
    default:
      return type.replace(/_/g, " ");
  }
}

function stageToBlockingAction(
  stage: TripDocumentRequirementStage,
): TripDocumentBlockingAction {
  switch (stage) {
    case TripDocumentRequirementStage.BEFORE_DISPATCH:
      return "PUBLISH";
    case TripDocumentRequirementStage.BEFORE_START:
      return "START";
    case TripDocumentRequirementStage.BEFORE_COMPLETE:
      return "COMPLETE";
    default:
      return "NONE";
  }
}

function uploaderToBlockingActor(
  uploader: TripDocumentResponsibleUploader,
): TripDocumentBlockingActor {
  switch (uploader) {
    case TripDocumentResponsibleUploader.OPERATIONS:
      return "OPERATIONS";
    case TripDocumentResponsibleUploader.EITHER:
      return "EITHER";
    default:
      return "DRIVER";
  }
}

function isLegacyImageLikeOtherDocument(doc: TripDocumentEvalInput): boolean {
  if (normalizeType(doc.type) !== TripDocumentType.OTHER) return false;
  const mime = String(doc.mimeType ?? "")
    .trim()
    .toLowerCase();

  // Meaningful MIME is authoritative.
  if (mime.startsWith(IMAGE_MIME_PREFIX)) return true;
  if (mime.length > 0 && mime !== "application/octet-stream") {
    // Non-image MIME (e.g. application/pdf) never qualifies via filename.
    return false;
  }

  // Filename extension fallback only when MIME is absent, blank, or octet-stream.
  const name = String(doc.originalName ?? doc.fileName ?? "")
    .trim()
    .toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function isPhotoRequirementType(type: string): boolean {
  return type === TripDocumentType.POD_PHOTO;
}

function documentMatchesRequirementType(
  doc: TripDocumentEvalInput,
  requirementType: string,
): boolean {
  const docType = normalizeType(doc.type);
  if (requirementType === TripDocumentType.POD_PHOTO) {
    if (docType === TripDocumentType.POD_PHOTO) return true;
    // Legacy compatibility only: verified image-like OTHER artifacts.
    return isLegacyImageLikeOtherDocument(doc);
  }
  return docType === requirementType;
}

function qualifyingDocsForRequirement(
  docs: TripDocumentEvalInput[],
  type: string,
  requiresSignature: boolean,
): TripDocumentEvalInput[] {
  const active = docs.filter(isActiveTripDocument);
  const matches = active.filter((d) => documentMatchesRequirementType(d, type));

  if (!requiresSignature) {
    return matches;
  }
  return matches.filter(isDocumentCanonicallySigned);
}

/**
 * Evaluate one requirement against active documents.
 * Inactive/replaced documents never satisfy. Signature uses isSigned|signedAt.
 * minCount is enforced: one of two required docs => PARTIAL / missingCount 1.
 */
export function evaluateTripDocumentRequirement(
  requirement: TripDocumentRequirementEvalInput,
  documents: TripDocumentEvalInput[],
): EvaluatedTripDocumentRequirement {
  const type = normalizeType(requirement.type);
  const minCount = Math.max(1, Number(requirement.minCount ?? 1) || 1);
  const requiresSignature = requirement.requiresSignature === true;
  const isRequired = requirement.isRequired !== false;
  const responsibleUploader = normalizeUploader(requirement.responsibleUploader);
  const requirementStage = normalizeStage(requirement.requirementStage);
  const label =
    String(requirement.label ?? "").trim() || defaultLabelForType(type);

  const qualifying = qualifyingDocsForRequirement(
    documents,
    type,
    requiresSignature,
  );
  const satisfiedCount = qualifying.length;
  const missingCount = isRequired ? Math.max(0, minCount - satisfiedCount) : 0;

  let satisfiedState: TripDocumentRequirementSatisfiedState = "SATISFIED";
  if (!isRequired && missingCount === 0 && satisfiedCount === 0) {
    satisfiedState = "NOT_REQUIRED";
  } else if (missingCount > 0) {
    const activeMatches = documents.filter(
      (d) =>
        isActiveTripDocument(d) && documentMatchesRequirementType(d, type),
    );
    if (
      requiresSignature &&
      activeMatches.length > 0 &&
      satisfiedCount === 0
    ) {
      satisfiedState = "UNSIGNED";
    } else if (satisfiedCount > 0 && missingCount > 0) {
      satisfiedState = "PARTIAL";
    } else {
      satisfiedState = "MISSING";
    }
  }

  const blocksLifecycle =
    isRequired &&
    missingCount > 0 &&
    requirementStage !== TripDocumentRequirementStage.REFERENCE_ONLY;

  const blockingAction = blocksLifecycle
    ? stageToBlockingAction(requirementStage)
    : "NONE";
  const blockingActor = blocksLifecycle
    ? uploaderToBlockingActor(responsibleUploader)
    : "NONE";

  return {
    requirementId: requirement.id ? String(requirement.id) : null,
    type,
    label,
    isRequired,
    minCount,
    satisfiedCount,
    missingCount,
    requiresSignature,
    signatureSatisfied:
      !requiresSignature ||
      (satisfiedCount >= minCount &&
        qualifying.every(isDocumentCanonicallySigned)),
    responsibleUploader,
    requirementStage,
    satisfiedState,
    blockingAction,
    blockingActor,
    blocksLifecycle,
  };
}

function legacyRequirementsFromDocuments(
  documents: TripDocumentEvalInput[],
): TripDocumentRequirementEvalInput[] {
  const active = documents.filter(isActiveTripDocument);
  const hasDeliveryDo = active.some(
    (d) => normalizeType(d.type) === TripDocumentType.DELIVERY_DO,
  );
  const rows: TripDocumentRequirementEvalInput[] = [
    {
      id: null,
      type: TripDocumentType.POD_PHOTO,
      label: "Proof of Delivery Photo",
      isRequired: true,
      requiresSignature: false,
      minCount: 1,
      sortOrder: 1,
      responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
      requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
    },
  ];
  if (hasDeliveryDo) {
    rows.unshift({
      id: null,
      type: TripDocumentType.DELIVERY_DO,
      label: "Delivery DO",
      isRequired: true,
      requiresSignature: true,
      minCount: 1,
      sortOrder: 0,
      responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
      requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
    });
  }
  return rows;
}

function prioritizeBlockingActor(
  actors: TripDocumentBlockingActor[],
): TripDocumentBlockingActor {
  if (actors.includes("OPERATIONS")) return "OPERATIONS";
  if (actors.includes("DRIVER")) return "DRIVER";
  if (actors.includes("EITHER")) return "EITHER";
  return "NONE";
}

function prioritizeBlockingAction(
  actions: TripDocumentBlockingAction[],
): TripDocumentBlockingAction {
  if (actions.includes("PUBLISH")) return "PUBLISH";
  if (actions.includes("START")) return "START";
  if (actions.includes("COMPLETE")) return "COMPLETE";
  return "NONE";
}

function readinessFromRequirements(
  cancelled: boolean,
  requirements: EvaluatedTripDocumentRequirement[],
): TripDocumentReadinessStatus {
  if (cancelled) return "UNAVAILABLE";
  const blockers = requirements.filter((r) => r.blocksLifecycle);
  if (blockers.length === 0) return "READY";
  const actor = prioritizeBlockingActor(blockers.map((r) => r.blockingActor));
  if (actor === "OPERATIONS") return "BLOCKED_BY_OPERATIONS";
  if (actor === "DRIVER" || actor === "EITHER") return "BLOCKED_BY_DRIVER";
  return "MISSING";
}

/**
 * Canonical trip document requirement evaluation.
 * Container/seal types are skipped here (evaluated per TripJobItem elsewhere).
 * Cancelled trips return UNAVAILABLE and do not count as incomplete for rollups.
 */
export function evaluateTripDocumentRequirements(input: {
  tripStatus?: string | null;
  documents: TripDocumentEvalInput[];
  requirements?: TripDocumentRequirementEvalInput[] | null;
  /** When set, only requirements whose stage matches (or blocks this action) are counted as lifecycle blockers for missingTypeCodes. */
  forStage?: TripDocumentRequirementStage | null;
}): TripDocumentRequirementEvaluation {
  const tripStatus = String(input.tripStatus ?? "")
    .trim()
    .toUpperCase();
  const cancelled = tripStatus === TripStatus.CANCELLED;

  const rawRequirements = (input.requirements ?? []).filter(
    (row) => !shouldSkipCompletionSnapshotType(row.type),
  );

  const evaluationSource: TripDocumentRequirementEvaluationSource =
    rawRequirements.length > 0 ? "SNAPSHOT" : "LEGACY_FALLBACK";

  const requirementInputs: TripDocumentRequirementEvalInput[] =
    evaluationSource === "SNAPSHOT"
      ? rawRequirements
      : legacyRequirementsFromDocuments(input.documents);

  const evaluated = requirementInputs
    .map((row) => evaluateTripDocumentRequirement(row, input.documents))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (cancelled) {
    return {
      tripStatus: tripStatus || null,
      cancelled: true,
      evaluationSource,
      requirements: evaluated.map((row) => ({
        ...row,
        blocksLifecycle: false,
        blockingAction: "NONE",
        blockingActor: "NONE",
        missingCount: 0,
      })),
      totalMissingCount: 0,
      readinessStatus: "UNAVAILABLE",
      blockingAction: "NONE",
      blockingActor: "NONE",
      missingTypeCodes: [],
      summaryLabels: [],
    };
  }

  const stageFilter = input.forStage
    ? normalizeStage(input.forStage)
    : null;

  const lifecycleBlockers = evaluated.filter((row) => {
    if (!row.blocksLifecycle) return false;
    if (!stageFilter) return true;
    return row.requirementStage === stageFilter;
  });

  const totalMissingCount = evaluated
    .filter((row) => row.isRequired)
    .reduce((sum, row) => sum + row.missingCount, 0);

  const missingTypeCodes = Array.from(
    new Set(
      lifecycleBlockers
        .filter((row) => row.missingCount > 0)
        .map((row) =>
          isPhotoRequirementType(row.type)
            ? PHOTO_DOCUMENTATION_MISSING_KEY
            : row.type,
        ),
    ),
  );

  const summaryLabels = lifecycleBlockers
    .filter((row) => row.missingCount > 0)
    .map((row) => {
      if (row.satisfiedState === "UNSIGNED") {
        return `Awaiting signed ${row.label}`;
      }
      if (row.blockingActor === "OPERATIONS") {
        return `Awaiting Operations: ${row.label}`;
      }
      if (row.blockingActor === "DRIVER") {
        return `Awaiting Driver: ${row.label}`;
      }
      return `Missing ${row.label}`;
    });

  return {
    tripStatus: tripStatus || null,
    cancelled: false,
    evaluationSource,
    requirements: evaluated,
    totalMissingCount,
    readinessStatus: readinessFromRequirements(false, evaluated),
    blockingAction: prioritizeBlockingAction(
      lifecycleBlockers.map((r) => r.blockingAction),
    ),
    blockingActor: prioritizeBlockingActor(
      lifecycleBlockers.map((r) => r.blockingActor),
    ),
    missingTypeCodes,
    summaryLabels,
  };
}

/** Gap type codes for a lifecycle stage (used by publish/start/complete). */
export function buildDocumentGapsForStage(
  documents: TripDocumentEvalInput[],
  requirements: TripDocumentRequirementEvalInput[] | null | undefined,
  stage: TripDocumentRequirementStage,
  tripStatus?: string | null,
): string[] {
  return evaluateTripDocumentRequirements({
    tripStatus,
    documents,
    requirements,
    forStage: stage,
  }).missingTypeCodes;
}

/**
 * Back-compat wrapper: completion-stage missing type codes.
 * Prefer evaluateTripDocumentRequirements for structured results.
 */
export function buildTripCompletionDocumentGapsFromEvaluation(
  documents: TripDocumentEvalInput[],
  requirements?: TripDocumentRequirementSnapshot[] | TripDocumentRequirementEvalInput[] | null,
  tripStatus?: string | null,
): string[] {
  const mapped = (requirements ?? []).map((row) => ({
    id: "id" in row ? (row as TripDocumentRequirementEvalInput).id : null,
    type: row.type,
    label: "label" in row ? (row as TripDocumentRequirementEvalInput).label : null,
    isRequired: row.isRequired,
    requiresSignature: row.requiresSignature,
    minCount:
      "minCount" in row
        ? (row as TripDocumentRequirementEvalInput).minCount
        : 1,
    sortOrder:
      "sortOrder" in row
        ? (row as TripDocumentRequirementEvalInput).sortOrder
        : 0,
    responsibleUploader:
      "responsibleUploader" in row
        ? (row as TripDocumentRequirementEvalInput).responsibleUploader
        : TripDocumentResponsibleUploader.DRIVER,
    requirementStage:
      "requirementStage" in row
        ? (row as TripDocumentRequirementEvalInput).requirementStage
        : TripDocumentRequirementStage.BEFORE_COMPLETE,
  }));
  return buildDocumentGapsForStage(
    documents,
    mapped,
    TripDocumentRequirementStage.BEFORE_COMPLETE,
    tripStatus,
  );
}

export function aggregateJobDocumentReadiness(
  tripEvaluations: TripDocumentRequirementEvaluation[],
): {
  readinessStatus: TripDocumentReadinessStatus;
  missingDocumentCount: number;
  missingLabels: string[];
  blockingActor: TripDocumentBlockingActor;
  primaryTripId: string | null;
} {
  const active = tripEvaluations.filter((e) => !e.cancelled);
  if (active.length === 0) {
    return {
      readinessStatus: "UNAVAILABLE",
      missingDocumentCount: 0,
      missingLabels: [],
      blockingActor: "NONE",
      primaryTripId: null,
    };
  }

  const missingDocumentCount = active.reduce(
    (sum, e) => sum + e.totalMissingCount,
    0,
  );
  const labels = active.flatMap((e) => e.summaryLabels);
  const uniqueLabels = Array.from(new Set(labels));
  const readinessStatus = (() => {
    if (active.every((e) => e.readinessStatus === "READY")) return "READY";
    if (active.some((e) => e.readinessStatus === "BLOCKED_BY_OPERATIONS")) {
      return "BLOCKED_BY_OPERATIONS";
    }
    if (active.some((e) => e.readinessStatus === "BLOCKED_BY_DRIVER")) {
      return "BLOCKED_BY_DRIVER";
    }
    if (missingDocumentCount > 0) return "MISSING";
    return "READY";
  })() as TripDocumentReadinessStatus;

  return {
    readinessStatus,
    missingDocumentCount,
    missingLabels: uniqueLabels.slice(0, 8),
    blockingActor: prioritizeBlockingActor(
      active.map((e) => e.blockingActor),
    ),
    primaryTripId: null,
  };
}

export function driverMayUploadRequirementType(
  requirements: TripDocumentRequirementEvalInput[] | null | undefined,
  documentType: string,
): boolean {
  const type = normalizeType(documentType);
  const matching = (requirements ?? []).filter(
    (row) => normalizeType(row.type) === type,
  );
  if (matching.length === 0) {
    // No snapshot row for this type: deny Operations-owned permit uploads by drivers.
    return type !== TripDocumentType.PERMIT;
  }
  return matching.some((row) => {
    const uploader = normalizeUploader(row.responsibleUploader);
    return (
      uploader === TripDocumentResponsibleUploader.DRIVER ||
      uploader === TripDocumentResponsibleUploader.EITHER
    );
  });
}

/** Duplicate key for Phase 1 requirement create: tenant + trip + type + stage. */
export function tripDocumentRequirementDuplicateKey(input: {
  tenantId: string;
  tripId: string;
  type: string;
  requirementStage?: string | null;
}): string {
  return [
    String(input.tenantId),
    String(input.tripId),
    normalizeType(input.type),
    normalizeStage(input.requirementStage),
  ].join(":");
}

/**
 * Pure unit-test helper: count trips missing snapshots from in-memory ID lists.
 * Not an executable database preflight — use
 * scripts/sql/preflight-trip-document-requirement-snapshots.sql for that.
 */
export function countTripsMissingDocumentRequirementSnapshots(input: {
  tripIds: string[];
  requirementTripIds: string[];
}): {
  totalTrips: number;
  tripsWithSnapshots: number;
  tripsMissingSnapshots: number;
  missingTripIds: string[];
} {
  const withSnapshots = new Set(
    input.requirementTripIds.filter((id) => typeof id === "string" && id.length > 0),
  );
  const missingTripIds = input.tripIds.filter((id) => !withSnapshots.has(id));
  return {
    totalTrips: input.tripIds.length,
    tripsWithSnapshots: input.tripIds.length - missingTripIds.length,
    tripsMissingSnapshots: missingTripIds.length,
    missingTripIds,
  };
}

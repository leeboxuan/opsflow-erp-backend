import { TripDocumentType } from "@prisma/client";
import type { TripDocumentRequirementSnapshot } from "../workflows/trip-document-requirements";
import { requirementSnapshotForType } from "../workflows/trip-document-requirements";
import { isDocumentCanonicallySigned } from "../workflows/trip-document-requirement-evaluation";

/** System-generated signable PDFs drivers may retry when the requirement exists without a file. */
export const DRIVER_ENSUREABLE_TRIP_DOCUMENT_TYPES = [
  TripDocumentType.DELIVERY_DO,
  TripDocumentType.LORRY_CHIT,
] as const;

export type DriverEnsureableTripDocumentType =
  (typeof DRIVER_ENSUREABLE_TRIP_DOCUMENT_TYPES)[number];

export type TripDocumentGenerationStatus =
  | "GENERATED"
  | "AWAITING_SIGNATURE"
  | "SIGNED"
  | "GENERATION_FAILED";

export function isDriverEnsureableTripDocumentType(
  type?: string | null,
): type is DriverEnsureableTripDocumentType {
  const key = String(type ?? "")
    .trim()
    .toUpperCase();
  return (DRIVER_ENSUREABLE_TRIP_DOCUMENT_TYPES as readonly string[]).includes(
    key,
  );
}

export function missingRequiredDocumentPlaceholderId(type: string): string {
  return `missing:${String(type).trim().toUpperCase()}`;
}

export function isMissingRequiredDocumentPlaceholderId(
  id?: string | null,
): boolean {
  return String(id ?? "")
    .trim()
    .toLowerCase()
    .startsWith("missing:");
}

export function resolveTripDocumentGenerationStatus(input: {
  hasDocument: boolean;
  isSigned?: boolean | null;
  signedAt?: Date | string | null;
  requiresSignature?: boolean | null;
}): TripDocumentGenerationStatus {
  if (!input.hasDocument) return "GENERATION_FAILED";
  if (
    isDocumentCanonicallySigned({
      isSigned: input.isSigned,
      signedAt: input.signedAt,
    })
  ) {
    return "SIGNED";
  }
  if (input.requiresSignature === true) return "AWAITING_SIGNATURE";
  return "GENERATED";
}

export function labelForEnsureableDocumentType(type: string): string {
  const key = String(type ?? "")
    .trim()
    .toUpperCase();
  if (key === TripDocumentType.DELIVERY_DO) return "Delivery DO";
  if (key === TripDocumentType.LORRY_CHIT) return "Lorry Chit";
  return key.replace(/_/g, " ");
}

/**
 * Append placeholder cards for required Delivery DO / Lorry Chit when no active
 * document exists so drivers see an actionable recovery row.
 */
export function appendMissingRequiredSignableDocumentPlaceholders<
  T extends {
    id: string;
    type: string;
    status?: string | null;
    label?: string | null;
    requiresSignature?: boolean | null;
    isSigned?: boolean | null;
    signedAt?: Date | string | null;
    generationStatus?: TripDocumentGenerationStatus | null;
    canRetryGenerate?: boolean | null;
  },
>(input: {
  documents: T[];
  requirements: TripDocumentRequirementSnapshot[] | null | undefined;
}): T[] {
  const docs = [...(input.documents ?? [])];
  const presentTypes = new Set(
    docs
      .map((d) =>
        String(d.type ?? "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean),
  );

  for (const type of DRIVER_ENSUREABLE_TRIP_DOCUMENT_TYPES) {
    const requirement = requirementSnapshotForType(input.requirements, type);
    if (!requirement || requirement.isRequired !== true) continue;
    if (presentTypes.has(type)) continue;

    const requiresSignature = requirement.requiresSignature === true;
    docs.push({
      id: missingRequiredDocumentPlaceholderId(type),
      type,
      status: "GENERATION_FAILED",
      label:
        String(requirement.label ?? "").trim() ||
        labelForEnsureableDocumentType(type),
      requiresSignature,
      isSigned: false,
      signedAt: null,
      generationStatus: "GENERATION_FAILED",
      canRetryGenerate: true,
    } as T);
  }

  return docs;
}

export function attachGenerationStatusToTripDocument<
  T extends {
    id?: string | null;
    type?: string | null;
    isSigned?: boolean | null;
    signedAt?: Date | string | null;
    requiresSignature?: boolean | null;
  },
>(
  doc: T,
  requirements?: TripDocumentRequirementSnapshot[] | null,
): T & {
  generationStatus: TripDocumentGenerationStatus;
  canRetryGenerate: boolean;
} {
  const type = String(doc.type ?? "")
    .trim()
    .toUpperCase();
  const requirement = requirementSnapshotForType(requirements, type);
  const requiresSignature =
    typeof doc.requiresSignature === "boolean"
      ? doc.requiresSignature
      : requirement?.requiresSignature === true;
  const isPlaceholder = isMissingRequiredDocumentPlaceholderId(doc.id);
  const generationStatus = resolveTripDocumentGenerationStatus({
    hasDocument: !isPlaceholder,
    isSigned: doc.isSigned,
    signedAt: doc.signedAt,
    requiresSignature,
  });
  return {
    ...doc,
    generationStatus,
    canRetryGenerate: isPlaceholder,
  };
}

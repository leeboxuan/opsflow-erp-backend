import {
  CollectionType,
  JobMessageImportDraftValidationStatus,
  JobMessageImportMovementType,
  JobType,
} from "@prisma/client";
import { parseValidJobItemsFromInput } from "../create-job-validation.helpers";
import type { JobMessageImportParseWarning } from "./job-message-parser";
import type {
  ControllerReviewedDraft,
  ControllerReviewedItem,
  JobMessageImportFieldError,
} from "./job-message-import.types";
import {
  normalizeCompanyName,
  normalizeLocationLabel,
  normalizeNotes,
  normalizePersonName,
} from "./job-message-import.text-normalize";

const ISO_CONTAINER_RE = /^[A-Z]{4}\d{7}$/;

export function trimToNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t.length ? t : null;
}

export function normalizePhone(v: string | null | undefined): string | null {
  const raw = trimToNull(v);
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  return digits.length ? digits : raw;
}

export function normalizeReviewedDraft(
  input: Omit<Partial<ControllerReviewedDraft>, "items"> &
    Pick<ControllerReviewedDraft, "movementType"> & {
      items?: Array<{
        containerNumber?: string | null;
        sealNumber?: string | null;
        referenceNumber?: string | null;
        quantity?: number | null;
      }>;
    },
): ControllerReviewedDraft {
  const items: ControllerReviewedItem[] = Array.isArray(input.items)
    ? input.items.map((it) => ({
        containerNumber: trimToNull(it?.containerNumber)?.toUpperCase() ?? null,
        sealNumber: trimToNull(it?.sealNumber)?.toUpperCase() ?? null,
        referenceNumber: trimToNull(it?.referenceNumber) ?? null,
        quantity:
          it?.quantity == null || it.quantity === ("" as unknown)
            ? null
            : Number.isFinite(Number(it.quantity))
              ? Number(it.quantity)
              : null,
      }))
    : [];

  const collectionRaw = trimToNull(input.collectionType as string | null);
  const collectionType =
    collectionRaw === CollectionType.EMPTY || collectionRaw === CollectionType.LOADED
      ? collectionRaw
      : null;

  const toCoord = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    movementType: input.movementType,
    collectionType,
    customerCompanyId: trimToNull(input.customerCompanyId),
    customerNameText: normalizeCompanyName(input.customerNameText),
    pickupAddress1: normalizeLocationLabel(input.pickupAddress1),
    pickupAddress2: trimToNull(input.pickupAddress2),
    pickupPostal: trimToNull(input.pickupPostal)?.replace(/\D/g, "").slice(0, 6) ?? null,
    pickupPlaceId: trimToNull(input.pickupPlaceId),
    pickupLat: toCoord(input.pickupLat),
    pickupLng: toCoord(input.pickupLng),
    deliveryAddress1: normalizeLocationLabel(input.deliveryAddress1),
    deliveryAddress2: trimToNull(input.deliveryAddress2),
    deliveryPostal: trimToNull(input.deliveryPostal)?.replace(/\D/g, "").slice(0, 6) ?? null,
    deliveryPlaceId: trimToNull(input.deliveryPlaceId),
    deliveryLat: toCoord(input.deliveryLat),
    deliveryLng: toCoord(input.deliveryLng),
    portAddress1: normalizeLocationLabel(input.portAddress1),
    portAddress2: trimToNull(input.portAddress2),
    portPostal: trimToNull(input.portPostal)?.replace(/\D/g, "").slice(0, 6) ?? null,
    portPlaceId: trimToNull(input.portPlaceId),
    portLat: toCoord(input.portLat),
    portLng: toCoord(input.portLng),
    returningDepotAddress1: normalizeLocationLabel(input.returningDepotAddress1),
    returningDepotAddress2: trimToNull(input.returningDepotAddress2),
    returningDepotPostal:
      trimToNull(input.returningDepotPostal)?.replace(/\D/g, "").slice(0, 6) ?? null,
    returningDepotPlaceId: trimToNull(input.returningDepotPlaceId),
    returningDepotLat: toCoord(input.returningDepotLat),
    returningDepotLng: toCoord(input.returningDepotLng),
    returningDepotCode: trimToNull(input.returningDepotCode),
    pickupDateLocal: trimToNull(input.pickupDateLocal),
    deliveryDateLocal: trimToNull(input.deliveryDateLocal),
    pickupDateDisplay: trimToNull(input.pickupDateDisplay),
    deliveryDateDisplay: trimToNull(input.deliveryDateDisplay),
    pickupDateNeedsReview: Boolean(input.pickupDateNeedsReview),
    deliveryDateNeedsReview: Boolean(input.deliveryDateNeedsReview),
    picName: normalizePersonName(input.picName),
    picPhone: normalizePhone(input.picPhone),
    notes: normalizeNotes(input.notes),
    instructions: Array.isArray(input.instructions)
      ? input.instructions.map((x) => String(x).trim()).filter(Boolean)
      : [],
    timingText: trimToNull(input.timingText),
    carrierName: trimToNull(input.carrierName),
    shipper: trimToNull(input.shipper),
    vesselName: trimToNull(input.vesselName),
    voyage: trimToNull(input.voyage),
    items,
  };
}

export type ReviewedDraftPatch = Omit<Partial<ControllerReviewedDraft>, "items"> & {
  items?: Array<{
    containerNumber?: string | null;
    sealNumber?: string | null;
    referenceNumber?: string | null;
    quantity?: number | null;
  }>;
};

export function mergeReviewedDraftPatch(
  current: ControllerReviewedDraft,
  patch: ReviewedDraftPatch,
): ControllerReviewedDraft {
  return normalizeReviewedDraft({
    ...current,
    ...(patch.movementType != null ? { movementType: patch.movementType } : {}),
    ...(patch.collectionType !== undefined ? { collectionType: patch.collectionType } : {}),
    ...(patch.customerCompanyId !== undefined
      ? { customerCompanyId: patch.customerCompanyId }
      : {}),
    ...(patch.customerNameText !== undefined ? { customerNameText: patch.customerNameText } : {}),
    ...(patch.pickupAddress1 !== undefined ? { pickupAddress1: patch.pickupAddress1 } : {}),
    ...(patch.pickupAddress2 !== undefined ? { pickupAddress2: patch.pickupAddress2 } : {}),
    ...(patch.pickupPostal !== undefined ? { pickupPostal: patch.pickupPostal } : {}),
    ...(patch.pickupPlaceId !== undefined ? { pickupPlaceId: patch.pickupPlaceId } : {}),
    ...(patch.pickupLat !== undefined ? { pickupLat: patch.pickupLat } : {}),
    ...(patch.pickupLng !== undefined ? { pickupLng: patch.pickupLng } : {}),
    ...(patch.deliveryAddress1 !== undefined ? { deliveryAddress1: patch.deliveryAddress1 } : {}),
    ...(patch.deliveryAddress2 !== undefined ? { deliveryAddress2: patch.deliveryAddress2 } : {}),
    ...(patch.deliveryPostal !== undefined ? { deliveryPostal: patch.deliveryPostal } : {}),
    ...(patch.deliveryPlaceId !== undefined ? { deliveryPlaceId: patch.deliveryPlaceId } : {}),
    ...(patch.deliveryLat !== undefined ? { deliveryLat: patch.deliveryLat } : {}),
    ...(patch.deliveryLng !== undefined ? { deliveryLng: patch.deliveryLng } : {}),
    ...(patch.portAddress1 !== undefined ? { portAddress1: patch.portAddress1 } : {}),
    ...(patch.portAddress2 !== undefined ? { portAddress2: patch.portAddress2 } : {}),
    ...(patch.portPostal !== undefined ? { portPostal: patch.portPostal } : {}),
    ...(patch.portPlaceId !== undefined ? { portPlaceId: patch.portPlaceId } : {}),
    ...(patch.portLat !== undefined ? { portLat: patch.portLat } : {}),
    ...(patch.portLng !== undefined ? { portLng: patch.portLng } : {}),
    ...(patch.returningDepotAddress1 !== undefined
      ? { returningDepotAddress1: patch.returningDepotAddress1 }
      : {}),
    ...(patch.returningDepotAddress2 !== undefined
      ? { returningDepotAddress2: patch.returningDepotAddress2 }
      : {}),
    ...(patch.returningDepotPostal !== undefined
      ? { returningDepotPostal: patch.returningDepotPostal }
      : {}),
    ...(patch.returningDepotPlaceId !== undefined
      ? { returningDepotPlaceId: patch.returningDepotPlaceId }
      : {}),
    ...(patch.returningDepotLat !== undefined
      ? { returningDepotLat: patch.returningDepotLat }
      : {}),
    ...(patch.returningDepotLng !== undefined
      ? { returningDepotLng: patch.returningDepotLng }
      : {}),
    ...(patch.returningDepotCode !== undefined
      ? { returningDepotCode: patch.returningDepotCode }
      : {}),
    ...(patch.pickupDateLocal !== undefined ? { pickupDateLocal: patch.pickupDateLocal } : {}),
    ...(patch.deliveryDateLocal !== undefined ? { deliveryDateLocal: patch.deliveryDateLocal } : {}),
    ...(patch.pickupDateDisplay !== undefined
      ? { pickupDateDisplay: patch.pickupDateDisplay }
      : {}),
    ...(patch.deliveryDateDisplay !== undefined
      ? { deliveryDateDisplay: patch.deliveryDateDisplay }
      : {}),
    ...(patch.pickupDateNeedsReview !== undefined
      ? { pickupDateNeedsReview: patch.pickupDateNeedsReview }
      : {}),
    ...(patch.deliveryDateNeedsReview !== undefined
      ? { deliveryDateNeedsReview: patch.deliveryDateNeedsReview }
      : {}),
    ...(patch.picName !== undefined ? { picName: patch.picName } : {}),
    ...(patch.picPhone !== undefined ? { picPhone: patch.picPhone } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}),
    ...(patch.timingText !== undefined ? { timingText: patch.timingText } : {}),
    ...(patch.carrierName !== undefined ? { carrierName: patch.carrierName } : {}),
    ...(patch.shipper !== undefined ? { shipper: patch.shipper } : {}),
    ...(patch.vesselName !== undefined ? { vesselName: patch.vesselName } : {}),
    ...(patch.voyage !== undefined ? { voyage: patch.voyage } : {}),
    ...(patch.items !== undefined ? { items: patch.items } : {}),
  });
}

export function movementTypeToJobType(
  mt: JobMessageImportMovementType,
): JobType | null {
  switch (mt) {
    case JobMessageImportMovementType.COLLECTION:
      return JobType.COLLECTION;
    case JobMessageImportMovementType.IMPORT:
      return JobType.IMPORT;
    case JobMessageImportMovementType.EXPORT:
      return JobType.EXPORT;
    case JobMessageImportMovementType.LCL:
      return JobType.LCL;
    default:
      return null;
  }
}

export type ReviewedDraftValidation = {
  warnings: JobMessageImportParseWarning[];
  fieldErrors: JobMessageImportFieldError[];
  hasBlockingErrors: boolean;
};

/**
 * Canonical server-side validator for preview init, PATCH revalidation, and confirm.
 * Does not invent values. Unknown optionals stay null.
 */
export function validateReviewedDraft(
  reviewed: ControllerReviewedDraft,
): ReviewedDraftValidation {
  const warnings: JobMessageImportParseWarning[] = [];
  const fieldErrors: JobMessageImportFieldError[] = [];

  const pushBlocking = (field: string, code: string, message: string) => {
    fieldErrors.push({ field, code, message });
    warnings.push({ code, field, message, severity: "BLOCKING" });
  };

  if (reviewed.movementType === JobMessageImportMovementType.UNKNOWN) {
    pushBlocking(
      "movementType",
      "UNKNOWN_MOVEMENT_TYPE",
      "Movement type could not be determined.",
    );
  }

  if (!reviewed.customerCompanyId) {
    pushBlocking(
      "customerCompanyId",
      "MISSING_CUSTOMER",
      "Customer must be selected from tenant companies.",
    );
  }

  if (reviewed.movementType === JobMessageImportMovementType.EXPORT) {
    // Empty-container depot (pickupAddress1) is optional reference only.
    if (!reviewed.deliveryAddress1) {
      pushBlocking(
        "deliveryAddress1",
        "MISSING_CUSTOMER",
        "Customer / stuffing location is required.",
      );
    }
    if (!reviewed.portAddress1) {
      pushBlocking(
        "portAddress1",
        "MISSING_PORT",
        "Export port / terminal is required.",
      );
    }
  } else if (reviewed.movementType === JobMessageImportMovementType.IMPORT) {
    if (!reviewed.pickupAddress1) {
      pushBlocking(
        "pickupAddress1",
        "MISSING_PORT",
        "Import port / terminal is required.",
      );
    }
    if (!reviewed.deliveryAddress1) {
      pushBlocking(
        "deliveryAddress1",
        "MISSING_CUSTOMER",
        "Customer / delivery location is required.",
      );
    }
    if (!reviewed.returningDepotAddress1 && !reviewed.returningDepotCode) {
      pushBlocking(
        "returningDepotAddress1",
        "MISSING_RETURN_DEPOT",
        "Empty container return depot is required.",
      );
    }
  } else {
    if (!reviewed.pickupAddress1) {
      pushBlocking("pickupAddress1", "MISSING_PICKUP", "Pickup location is required.");
    }
    if (!reviewed.deliveryAddress1) {
      pushBlocking(
        "deliveryAddress1",
        "MISSING_DELIVERY",
        "Delivery location is required.",
      );
    }
  }

  const postalOk = (v: string | null) => !v || /^\d{6}$/.test(v);
  if (!postalOk(reviewed.pickupPostal)) {
    pushBlocking("pickupPostal", "INVALID_POSTAL", "Postal code must be 6 digits.");
  }
  if (!postalOk(reviewed.deliveryPostal)) {
    pushBlocking("deliveryPostal", "INVALID_POSTAL", "Postal code must be 6 digits.");
  }

  if (reviewed.pickupDateNeedsReview) {
    pushBlocking(
      "pickupDateLocal",
      "PICKUP_TIME_NEEDS_REVIEW",
      reviewed.pickupDateDisplay || "Pickup date/time needs review.",
    );
  }
  if (reviewed.deliveryDateNeedsReview) {
    pushBlocking(
      "deliveryDateLocal",
      "DELIVERY_TIME_NEEDS_REVIEW",
      reviewed.deliveryDateDisplay || "Delivery date/time needs review.",
    );
  }

  if (reviewed.movementType === JobMessageImportMovementType.COLLECTION) {
    if (
      reviewed.collectionType !== CollectionType.EMPTY &&
      reviewed.collectionType !== CollectionType.LOADED
    ) {
      pushBlocking(
        "collectionType",
        "MISSING_COLLECTION_TYPE",
        "Collection type is required for COLLECTION jobs (EMPTY or LOADED).",
      );
    }
  }

  const jobType = movementTypeToJobType(reviewed.movementType);
  if (jobType) {
    const mappedItems = reviewed.items.map((it) =>
      jobType === JobType.LCL
        ? {
            itemCode: it.referenceNumber || it.containerNumber,
            qty: it.quantity ?? 1,
            sealNo: it.sealNumber,
          }
        : {
            containerNumber: it.containerNumber || it.referenceNumber,
            sealNo: it.sealNumber,
            qty: it.quantity,
          },
    );
    const validItems = parseValidJobItemsFromInput(mappedItems, jobType);
    if (!validItems.length) {
      pushBlocking(
        "items",
        "MISSING_ITEMS",
        "At least one valid container or item code is required.",
      );
    }

    for (const it of reviewed.items) {
      const code = (it.containerNumber || "").replace(/\s+/g, "").toUpperCase();
      if (code && ISO_CONTAINER_RE.test(code) === false && /^[A-Z]{4}\d+$/.test(code)) {
        warnings.push({
          code: "CONTAINER_FORMAT",
          field: "items",
          message: `Container ${code} is not a standard ISO 6346 number.`,
          severity: "WARNING",
        });
      }
    }
  }

  return {
    warnings,
    fieldErrors,
    hasBlockingErrors: fieldErrors.length > 0,
  };
}

export function classifyValidationStatus(input: {
  hasBlockingErrors: boolean;
  duplicateCandidateCount: number;
  duplicateOverrideAcknowledged: boolean;
}): JobMessageImportDraftValidationStatus {
  if (input.hasBlockingErrors) {
    return JobMessageImportDraftValidationStatus.NEEDS_REVIEW;
  }
  if (input.duplicateCandidateCount > 0 && !input.duplicateOverrideAcknowledged) {
    return JobMessageImportDraftValidationStatus.POSSIBLE_DUPLICATE;
  }
  return JobMessageImportDraftValidationStatus.READY;
}

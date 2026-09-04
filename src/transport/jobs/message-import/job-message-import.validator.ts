import {
  CollectionType,
  JobMessageImportDraftValidationStatus,
  JobMessageImportMovementType,
  JobType,
} from "@prisma/client";
import { parseValidJobItemsFromInput } from "../create-job-validation.helpers";
import { mapReviewedItemsForParse } from "./job-message-import.items-map";
import { normalizeAutoTripDocumentRequirements } from "../../workflows/trip-document-create-flags";
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
import {
  type AddressVerificationStatus,
  resolveImportedLocation,
} from "./job-message-import.location-verification";

const ISO_CONTAINER_RE = /^[A-Z]{4}\d{7}$/;

function resolveSlotVerification(input: {
  sourceText?: string | null;
  placeId?: string | null;
  address1?: string | null;
  postal?: string | null;
  code?: string | null;
}): AddressVerificationStatus {
  return resolveImportedLocation({
    rawText: input.sourceText ?? input.address1 ?? null,
    address1: input.address1 ?? null,
    postal: input.postal ?? null,
    placeId: input.placeId ?? null,
    code: input.code ?? null,
  }).verificationStatus;
}

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

  const draft: ControllerReviewedDraft = {
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
    returningDepotPending: input.returningDepotPending === true,
    returningDepotPendingText:
      trimToNull(input.returningDepotPendingText) ??
      (input.returningDepotPending === true
        ? trimToNull(input.returningDepotSourceText) ??
          normalizeLocationLabel(input.returningDepotAddress1)
        : null),
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
    containerSizeType: trimToNull(input.containerSizeType),
    autoTripDocumentRequirements: normalizeAutoTripDocumentRequirements(
      input.autoTripDocumentRequirements,
    ),
    items,
    pickupReference:
      trimToNull((input as { pickupReference?: string | null }).pickupReference) ??
      (input.movementType === JobMessageImportMovementType.COLLECTION
        ? items.map((it) => it.referenceNumber).find((v) => !!v) ?? null
        : null),
    pickupSourceText: trimToNull(input.pickupSourceText) ?? normalizeLocationLabel(input.pickupAddress1),
    deliverySourceText:
      trimToNull(input.deliverySourceText) ?? normalizeLocationLabel(input.deliveryAddress1),
    portSourceText: trimToNull(input.portSourceText) ?? normalizeLocationLabel(input.portAddress1),
    returningDepotSourceText:
      trimToNull(input.returningDepotSourceText) ??
      normalizeLocationLabel(input.returningDepotAddress1),
    pickupVerificationStatus: resolveSlotVerification({
      sourceText: input.pickupSourceText,
      placeId: input.pickupPlaceId,
      address1: input.pickupAddress1,
      postal: input.pickupPostal,
    }),
    deliveryVerificationStatus: resolveSlotVerification({
      sourceText: input.deliverySourceText,
      placeId: input.deliveryPlaceId,
      address1: input.deliveryAddress1,
      postal: input.deliveryPostal,
    }),
    portVerificationStatus: resolveSlotVerification({
      sourceText: input.portSourceText,
      placeId: input.portPlaceId,
      address1: input.portAddress1,
      postal: input.portPostal,
    }),
    returningDepotVerificationStatus: resolveSlotVerification({
      sourceText: input.returningDepotSourceText,
      placeId: input.returningDepotPlaceId,
      address1: input.returningDepotAddress1,
      postal: input.returningDepotPostal,
      code: input.returningDepotCode,
    }),
  };

  const promoted = promoteReturnDeliveryToDepot(draft);
  // Pending-depot acknowledgement is RETURN-only. Never clear destinations for other types.
  if (promoted.movementType !== JobMessageImportMovementType.RETURN) {
    if (!promoted.returningDepotPending && !promoted.returningDepotPendingText) {
      return promoted;
    }
    return {
      ...promoted,
      returningDepotPending: false,
      returningDepotPendingText: null,
    };
  }
  if (!promoted.returningDepotPending) return promoted;
  return {
    ...promoted,
    // Pending acknowledgement: keep source text, never treat TBA as a real address.
    returningDepotAddress1: null,
    returningDepotAddress2: null,
    returningDepotPostal: null,
    returningDepotPlaceId: null,
    returningDepotLat: null,
    returningDepotLng: null,
    returningDepotCode: null,
    deliveryAddress1: null,
    deliveryAddress2: null,
    deliveryPostal: null,
    deliveryPlaceId: null,
    deliveryLat: null,
    deliveryLng: null,
    returningDepotPendingText:
      promoted.returningDepotPendingText ??
      promoted.returningDepotSourceText,
  };
}

/** When type is RETURN, keep extracted "to - …" on returningDepot* (not empty Custom). */
export function promoteReturnDeliveryToDepot(
  draft: ControllerReviewedDraft,
): ControllerReviewedDraft {
  if (draft.movementType !== JobMessageImportMovementType.RETURN) return draft;
  if (draft.returningDepotAddress1 || draft.returningDepotCode || draft.returningDepotSourceText) {
    return draft;
  }
  const source =
    draft.deliverySourceText || draft.deliveryAddress1;
  if (!source) return draft;
  return {
    ...draft,
    returningDepotAddress1: draft.deliveryAddress1 ?? source,
    returningDepotAddress2: draft.deliveryAddress2,
    returningDepotPostal: draft.deliveryPostal,
    returningDepotPlaceId: draft.deliveryPlaceId,
    returningDepotLat: draft.deliveryLat,
    returningDepotLng: draft.deliveryLng,
    returningDepotSourceText: source,
    deliveryAddress1: null,
    deliveryAddress2: null,
    deliveryPostal: null,
    deliveryPlaceId: null,
    deliveryLat: null,
    deliveryLng: null,
    deliverySourceText: null,
    returningDepotVerificationStatus: resolveSlotVerification({
      sourceText: source,
      address1: draft.deliveryAddress1 ?? source,
      postal: draft.deliveryPostal,
      placeId: draft.deliveryPlaceId,
    }),
  };
}

export type ReviewedDraftPatch = Omit<Partial<ControllerReviewedDraft>, "items"> & {
  items?: Array<{
    containerNumber?: string | null;
    sealNumber?: string | null;
    referenceNumber?: string | null;
    quantity?: number | null;
  }>;
  pickupReference?: string | null;
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
    ...(patch.containerSizeType !== undefined
      ? { containerSizeType: patch.containerSizeType }
      : {}),
    ...(patch.autoTripDocumentRequirements !== undefined
      ? { autoTripDocumentRequirements: patch.autoTripDocumentRequirements }
      : {}),
    ...(patch.items !== undefined ? { items: patch.items } : {}),
    ...((patch as { pickupReference?: string | null }).pickupReference !== undefined
      ? { pickupReference: (patch as { pickupReference?: string | null }).pickupReference }
      : {}),
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
    case JobMessageImportMovementType.RETURN:
      return JobType.RETURN;
    case JobMessageImportMovementType.ONE_WAY:
      return JobType.ONE_WAY;
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
  } else if (reviewed.movementType === JobMessageImportMovementType.RETURN) {
    if (!reviewed.pickupAddress1) {
      pushBlocking("pickupAddress1", "MISSING_PICKUP", "Pickup location is required.");
    }
    const depotPending = reviewed.returningDepotPending === true;
    const hasDepot = Boolean(reviewed.returningDepotAddress1 || reviewed.returningDepotCode);
    if (depotPending) {
      // Intake acknowledgement: Draft confirm allowed; publish still requires a depot.
    } else if (!hasDepot) {
      pushBlocking(
        "returningDepotAddress1",
        "MISSING_RETURN_DEPOT",
        "Select a return depot, or choose Depot not confirmed yet.",
      );
    } else if (
      reviewed.returningDepotVerificationStatus === "UNRESOLVED" &&
      !reviewed.returningDepotCode
    ) {
      pushBlocking(
        "returningDepotAddress1",
        "LOCATION_UNRESOLVED",
        "Location is unresolved (TBA or unusable). Select a depot, enter a custom address, or choose Depot not confirmed yet.",
      );
    } else if (
      reviewed.returningDepotVerificationStatus === "NEEDS_REVIEW" &&
      !reviewed.returningDepotCode
    ) {
      pushBlocking(
        "returningDepotAddress1",
        "RETURN_DEPOT_NEEDS_CONFIRMATION",
        "Return depot needs confirmation. Select a depot, enter a custom address, or choose Depot not confirmed yet.",
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

  const pushUnresolved = (
    field: string,
    status: AddressVerificationStatus,
    present: boolean,
  ) => {
    if (present && status === "UNRESOLVED") {
      pushBlocking(
        field,
        "LOCATION_UNRESOLVED",
        "Location is unresolved (TBA or unusable). Select an address before confirming.",
      );
    }
  };
  if (reviewed.movementType === JobMessageImportMovementType.EXPORT) {
    pushUnresolved(
      "deliveryAddress1",
      reviewed.deliveryVerificationStatus,
      Boolean(reviewed.deliveryAddress1),
    );
    pushUnresolved("portAddress1", reviewed.portVerificationStatus, Boolean(reviewed.portAddress1));
  } else if (reviewed.movementType === JobMessageImportMovementType.IMPORT) {
    pushUnresolved("pickupAddress1", reviewed.pickupVerificationStatus, Boolean(reviewed.pickupAddress1));
    pushUnresolved(
      "deliveryAddress1",
      reviewed.deliveryVerificationStatus,
      Boolean(reviewed.deliveryAddress1),
    );
    pushUnresolved(
      "returningDepotAddress1",
      reviewed.returningDepotVerificationStatus,
      Boolean(reviewed.returningDepotAddress1 || reviewed.returningDepotCode),
    );
  } else if (reviewed.movementType === JobMessageImportMovementType.RETURN) {
    pushUnresolved("pickupAddress1", reviewed.pickupVerificationStatus, Boolean(reviewed.pickupAddress1));
    // Return depot confirmation / unresolved handled above with priority messages.
  } else {
    pushUnresolved("pickupAddress1", reviewed.pickupVerificationStatus, Boolean(reviewed.pickupAddress1));
    pushUnresolved(
      "deliveryAddress1",
      reviewed.deliveryVerificationStatus,
      Boolean(reviewed.deliveryAddress1),
    );
  }

  const postalOk = (v: string | null) => !v || /^\d{6}$/.test(v);
  if (!postalOk(reviewed.pickupPostal)) {
    pushBlocking("pickupPostal", "INVALID_POSTAL", "Postal code must be 6 digits.");
  }
  if (!postalOk(reviewed.deliveryPostal)) {
    pushBlocking("deliveryPostal", "INVALID_POSTAL", "Postal code must be 6 digits.");
  }

  if (reviewed.pickupDateNeedsReview) {
    const display = reviewed.pickupDateDisplay || "";
    const ambiguous =
      /needs review|ambiguous|constraint|window|could not/i.test(display);
    const detentionOrEtaOnly =
      /\bdet(?:ention)?\b|\beta\b/i.test(String(reviewed.timingText ?? "")) &&
      !reviewed.pickupDateLocal;
    if (ambiguous && !detentionOrEtaOnly) {
      pushBlocking(
        "pickupDateLocal",
        "PICKUP_TIME_NEEDS_REVIEW",
        reviewed.pickupDateDisplay || "Pickup date/time needs review.",
      );
    }
  }
  if (reviewed.deliveryDateNeedsReview) {
    const display = reviewed.deliveryDateDisplay || "";
    const ambiguous =
      /needs review|ambiguous|constraint|window|could not/i.test(display);
    if (ambiguous) {
      pushBlocking(
        "deliveryDateLocal",
        "DELIVERY_TIME_NEEDS_REVIEW",
        reviewed.deliveryDateDisplay || "Delivery date/time needs review.",
      );
    }
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
    const mappedItems = mapReviewedItemsForParse(reviewed, jobType);
    const validItems = parseValidJobItemsFromInput(mappedItems, jobType);
    if (!validItems.length && jobType !== JobType.COLLECTION) {
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

export type AddressVerificationStatus =
  | "VERIFIED"
  | "MANUAL_CONFIRMED"
  | "NEEDS_REVIEW"
  | "UNRESOLVED";

export type MasterLocationRecord = {
  code: string;
  name: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type ResolvedLocation = {
  sourceText: string | null;
  address1: string | null;
  address2: string | null;
  postal: string | null;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  code: string | null;
  verificationStatus: AddressVerificationStatus;
};

const UNRESOLVED_EXACT = /^(tba|t\.b\.a\.|n\/a|na|nil|unknown|-)$/i;

export function isSingaporePostal(raw: string | null | undefined): boolean {
  return /^\d{6}$/.test(String(raw ?? "").trim());
}

export function isUnresolvedLocationText(raw: string | null | undefined): boolean {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (UNRESOLVED_EXACT.test(text)) return true;
  if (/\btba\b/i.test(text) && /wait|or tuas|hla or/i.test(text)) return true;
  if (/^tba\b/i.test(text)) return true;
  return false;
}

function normalizeKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}

function trimOrNull(value: string | null | undefined): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length ? text : null;
}

/**
 * Tenant/master match only. No hardcoded nicknames.
 * Unique exact code or unique exact name → confident match.
 */
export function matchMasterLocation(
  raw: string | null | undefined,
  catalogue: readonly MasterLocationRecord[],
): MasterLocationRecord | null {
  const key = normalizeKey(raw ?? "");
  if (!key || isUnresolvedLocationText(raw)) return null;
  const byCode = catalogue.filter((row) => normalizeKey(row.code) === key);
  if (byCode.length === 1) return byCode[0]!;
  const byName = catalogue.filter((row) => normalizeKey(row.name) === key);
  if (byName.length === 1) return byName[0]!;
  return null;
}

/**
 * Server-side location classification. Callers must not pass a client verification
 * status — Google/master VERIFIED is earned here, not trusted from the wire.
 */
export function resolveImportedLocation(input: {
  rawText: string | null | undefined;
  catalogue?: readonly MasterLocationRecord[];
  placeId?: string | null;
  postal?: string | null;
  address1?: string | null;
  address2?: string | null;
  lat?: number | null;
  lng?: number | null;
  code?: string | null;
}): ResolvedLocation {
  const sourceText = trimOrNull(input.rawText);
  const address1 = trimOrNull(input.address1);
  const postal = isSingaporePostal(input.postal) ? String(input.postal).trim() : trimOrNull(input.postal);
  const placeId = trimOrNull(input.placeId);
  const code = trimOrNull(input.code);
  const workingAddress = address1 || sourceText;
  const catalogue = input.catalogue ?? [];

  const matched =
    matchMasterLocation(code, catalogue) ||
    (!isUnresolvedLocationText(workingAddress)
      ? matchMasterLocation(workingAddress, catalogue)
      : null);

  if (matched) {
    return {
      sourceText,
      address1: matched.addressLine1 || matched.name,
      address2: matched.addressLine2 ?? trimOrNull(input.address2),
      postal: matched.postalCode ?? (isSingaporePostal(postal) ? postal : null),
      placeId: matched.placeId ?? placeId,
      lat: matched.lat ?? input.lat ?? null,
      lng: matched.lng ?? input.lng ?? null,
      code: matched.code,
      verificationStatus: "VERIFIED",
    };
  }

  if (isUnresolvedLocationText(workingAddress) && !placeId && !code) {
    return {
      sourceText,
      address1: workingAddress,
      address2: trimOrNull(input.address2),
      postal: null,
      placeId: null,
      lat: null,
      lng: null,
      code: null,
      verificationStatus: "UNRESOLVED",
    };
  }

  if (placeId && isSingaporePostal(postal)) {
    return {
      sourceText,
      address1: address1 ?? sourceText,
      address2: trimOrNull(input.address2),
      postal,
      placeId,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      code,
      verificationStatus: "VERIFIED",
    };
  }

  if (placeId && !isSingaporePostal(postal)) {
    return {
      sourceText,
      address1: address1 ?? sourceText,
      address2: trimOrNull(input.address2),
      postal: postal,
      placeId,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      code,
      verificationStatus: "NEEDS_REVIEW",
    };
  }

  if (workingAddress && isSingaporePostal(postal)) {
    return {
      sourceText,
      address1: address1 ?? sourceText,
      address2: trimOrNull(input.address2),
      postal,
      placeId: null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      code,
      verificationStatus: "MANUAL_CONFIRMED",
    };
  }

  return {
    sourceText,
    address1: address1 ?? sourceText,
    address2: trimOrNull(input.address2),
    postal: isSingaporePostal(postal) ? postal : postal,
    placeId: null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    code,
    verificationStatus: "NEEDS_REVIEW",
  };
}

export function applyMasterMatchesToReviewedDraft(
  reviewed: {
    movementType: string;
    pickupAddress1: string | null;
    pickupSourceText?: string | null;
    pickupPlaceId: string | null;
    pickupPostal: string | null;
    pickupAddress2: string | null;
    pickupLat: number | null;
    pickupLng: number | null;
    deliveryAddress1: string | null;
    deliverySourceText?: string | null;
    deliveryPlaceId: string | null;
    deliveryPostal: string | null;
    deliveryAddress2: string | null;
    deliveryLat: number | null;
    deliveryLng: number | null;
    portAddress1: string | null;
    portPostal: string | null;
    portPlaceId: string | null;
    returningDepotAddress1: string | null;
    returningDepotPostal: string | null;
    returningDepotPlaceId: string | null;
    returningDepotCode: string | null;
    returningDepotLat: number | null;
    returningDepotLng: number | null;
    returningDepotAddress2: string | null;
  },
  catalogues: {
    ports: readonly MasterLocationRecord[];
    depots: readonly MasterLocationRecord[];
  },
) {
  const pickup = resolveImportedLocation({
    rawText: reviewed.pickupSourceText ?? reviewed.pickupAddress1,
    address1: reviewed.pickupAddress1,
    postal: reviewed.pickupPostal,
    placeId: reviewed.pickupPlaceId,
    address2: reviewed.pickupAddress2,
    lat: reviewed.pickupLat,
    lng: reviewed.pickupLng,
    catalogue:
      reviewed.movementType === "IMPORT" ? catalogues.ports : catalogues.depots,
  });
  const delivery = resolveImportedLocation({
    rawText: reviewed.deliverySourceText ?? reviewed.deliveryAddress1,
    address1: reviewed.deliveryAddress1,
    postal: reviewed.deliveryPostal,
    placeId: reviewed.deliveryPlaceId,
    address2: reviewed.deliveryAddress2,
    lat: reviewed.deliveryLat,
    lng: reviewed.deliveryLng,
    catalogue: catalogues.depots,
  });
  const depot = resolveImportedLocation({
    rawText: reviewed.returningDepotAddress1,
    address1: reviewed.returningDepotAddress1,
    postal: reviewed.returningDepotPostal,
    placeId: reviewed.returningDepotPlaceId,
    address2: reviewed.returningDepotAddress2,
    code: reviewed.returningDepotCode,
    lat: reviewed.returningDepotLat,
    lng: reviewed.returningDepotLng,
    catalogue: catalogues.depots,
  });
  const port = resolveImportedLocation({
    rawText: reviewed.portAddress1,
    address1: reviewed.portAddress1,
    postal: reviewed.portPostal,
    placeId: reviewed.portPlaceId,
    catalogue: catalogues.ports,
  });
  return {
    pickup,
    delivery,
    depot,
    port,
  };
}

export function locationVerificationWarning(
  status: AddressVerificationStatus | null | undefined,
): { tone: "warning" | "danger"; message: string } | null {
  if (status === "UNRESOLVED") {
    return {
      tone: "danger",
      message: "Location is unresolved (TBA or unusable). Select an address before confirming.",
    };
  }
  if (status === "NEEDS_REVIEW") {
    return {
      tone: "warning",
      message: "Postal code not verified — select an address or enter it manually.",
    };
  }
  return null;
}

type ReviewedLocationDraft = Parameters<typeof applyMasterMatchesToReviewedDraft>[0] & {
  pickupSourceText?: string | null;
  deliverySourceText?: string | null;
  portSourceText?: string | null;
  returningDepotSourceText?: string | null;
  pickupVerificationStatus?: AddressVerificationStatus;
  deliveryVerificationStatus?: AddressVerificationStatus;
  portVerificationStatus?: AddressVerificationStatus;
  returningDepotVerificationStatus?: AddressVerificationStatus;
};

/**
 * Recompute verification from address evidence + tenant catalogues.
 * Ignores any client-supplied verificationStatus.
 * VERIFIED slots may fill master/Google fields; MANUAL_CONFIRMED keeps human text.
 */
export function applyResolvedLocationsOntoReviewed<T extends ReviewedLocationDraft>(
  reviewed: T,
  catalogues: {
    ports: readonly MasterLocationRecord[];
    depots: readonly MasterLocationRecord[];
  },
): T {
  const matched = applyMasterMatchesToReviewedDraft(reviewed, catalogues);
  const takeVerified = (
    resolved: ResolvedLocation,
    current: {
      address1: string | null;
      address2: string | null;
      postal: string | null;
      placeId: string | null;
      lat: number | null;
      lng: number | null;
      code?: string | null;
    },
  ) => {
    if (resolved.verificationStatus !== "VERIFIED") {
      return {
        address1: current.address1,
        address2: current.address2,
        postal: current.postal,
        placeId: current.placeId,
        lat: current.lat,
        lng: current.lng,
        code: current.code ?? null,
      };
    }
    return {
      address1: resolved.address1,
      address2: resolved.address2,
      postal: resolved.postal,
      placeId: resolved.placeId,
      lat: resolved.lat,
      lng: resolved.lng,
      code: resolved.code,
    };
  };

  const pickupFields = takeVerified(matched.pickup, {
    address1: reviewed.pickupAddress1,
    address2: reviewed.pickupAddress2,
    postal: reviewed.pickupPostal,
    placeId: reviewed.pickupPlaceId,
    lat: reviewed.pickupLat,
    lng: reviewed.pickupLng,
  });
  const deliveryFields = takeVerified(matched.delivery, {
    address1: reviewed.deliveryAddress1,
    address2: reviewed.deliveryAddress2,
    postal: reviewed.deliveryPostal,
    placeId: reviewed.deliveryPlaceId,
    lat: reviewed.deliveryLat,
    lng: reviewed.deliveryLng,
  });
  const depotFields = takeVerified(matched.depot, {
    address1: reviewed.returningDepotAddress1,
    address2: reviewed.returningDepotAddress2,
    postal: reviewed.returningDepotPostal,
    placeId: reviewed.returningDepotPlaceId,
    lat: reviewed.returningDepotLat,
    lng: reviewed.returningDepotLng,
    code: reviewed.returningDepotCode,
  });
  const portFields = takeVerified(matched.port, {
    address1: reviewed.portAddress1,
    address2: reviewed.portAddress1 ? reviewed.portAddress1 : null,
    postal: reviewed.portPostal,
    placeId: reviewed.portPlaceId,
    lat: null,
    lng: null,
  });

  return {
    ...reviewed,
    pickupAddress1: pickupFields.address1,
    pickupAddress2: pickupFields.address2,
    pickupPostal: pickupFields.postal,
    pickupPlaceId: pickupFields.placeId,
    pickupLat: pickupFields.lat,
    pickupLng: pickupFields.lng,
    pickupVerificationStatus: matched.pickup.verificationStatus,
    pickupSourceText: reviewed.pickupSourceText ?? matched.pickup.sourceText,
    deliveryAddress1: deliveryFields.address1,
    deliveryAddress2: deliveryFields.address2,
    deliveryPostal: deliveryFields.postal,
    deliveryPlaceId: deliveryFields.placeId,
    deliveryLat: deliveryFields.lat,
    deliveryLng: deliveryFields.lng,
    deliveryVerificationStatus: matched.delivery.verificationStatus,
    deliverySourceText: reviewed.deliverySourceText ?? matched.delivery.sourceText,
    returningDepotAddress1: depotFields.address1,
    returningDepotAddress2: depotFields.address2,
    returningDepotPostal: depotFields.postal,
    returningDepotPlaceId: depotFields.placeId,
    returningDepotLat: depotFields.lat,
    returningDepotLng: depotFields.lng,
    returningDepotCode: depotFields.code,
    returningDepotVerificationStatus: matched.depot.verificationStatus,
    returningDepotSourceText:
      reviewed.returningDepotSourceText ?? matched.depot.sourceText,
    portAddress1: portFields.address1,
    portPostal: portFields.postal,
    portPlaceId: portFields.placeId,
    portVerificationStatus: matched.port.verificationStatus,
    portSourceText: reviewed.portSourceText ?? matched.port.sourceText,
  };
}

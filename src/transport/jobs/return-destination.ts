/**
 * Canonical RETURN destination contract shared by Create Job and Import Message.
 * RETURN route is pickup → selected depot. The Job row still stores a non-empty
 * deliveryAddress1 when resolved (DB + CreateJobDto); that value is the depot's
 * canonical address (or the custom depot address), never a second user-entered destination.
 *
 * Intake may explicitly mark the depot as pending: Draft Job + Trip with unset
 * destination are allowed; publish/dispatch still requires a resolved depot.
 */

export const RETURN_DEPOT_PENDING_SELECT_VALUE = "__depot_pending__";

export type ReturnDestinationFields = {
  deliveryAddress1: string;
  deliveryAddress2: string | null;
  deliveryPostal: string | null;
  deliveryPlaceId: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  returningDepotCode: string | null;
  returningDepotAddress1: string | null;
  returningDepotAddress2: string | null;
  returningDepotPostal: string | null;
  returningDepotPlaceId: string | null;
  returningDepotLat: number | null;
  returningDepotLng: number | null;
};

export type ReturnDestinationPending = {
  kind: "pending";
  /** Preserved TBA/source wording — never written to deliveryAddress1. */
  pendingText: string | null;
};

export type ReturnDestinationResolved = {
  kind: "resolved";
  fields: ReturnDestinationFields;
};

export type ReturnDestinationResolution =
  | ReturnDestinationPending
  | ReturnDestinationResolved;

function trimToNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t.length ? t : null;
}

/** True when the operator explicitly chose "Depot not confirmed yet". */
export function isReturnDepotPendingSelection(
  value: string | null | undefined,
): boolean {
  return String(value ?? "").trim() === RETURN_DEPOT_PENDING_SELECT_VALUE;
}

/**
 * Resolve RETURN destination from depot selection / custom address / explicit pending.
 * Prefer returningDepot*; fall back to delivery* only for legacy payloads.
 * Never invents an address from TBA/pending text.
 */
export function resolveReturnDestinationResolution(input: {
  returningDepotPending?: boolean | null;
  returningDepotPendingText?: string | null;
  returningDepotCode?: string | null;
  returningDepotAddress1?: string | null;
  returningDepotAddress2?: string | null;
  returningDepotPostal?: string | null;
  returningDepotPlaceId?: string | null;
  returningDepotLat?: number | null;
  returningDepotLng?: number | null;
  deliveryAddress1?: string | null;
  deliveryAddress2?: string | null;
  deliveryPostal?: string | null;
  deliveryPlaceId?: string | null;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
}): ReturnDestinationResolution | null {
  if (input.returningDepotPending === true) {
    return {
      kind: "pending",
      pendingText:
        trimToNull(input.returningDepotPendingText) ??
        trimToNull(input.returningDepotAddress1) ??
        trimToNull(input.deliveryAddress1),
    };
  }

  const fields = resolveReturnDestinationFields(input);
  if (!fields) return null;
  return { kind: "resolved", fields };
}

/**
 * Resolve RETURN destination from depot selection / custom address.
 * Prefer returningDepot*; fall back to delivery* only for legacy payloads.
 */
export function resolveReturnDestinationFields(input: {
  returningDepotCode?: string | null;
  returningDepotAddress1?: string | null;
  returningDepotAddress2?: string | null;
  returningDepotPostal?: string | null;
  returningDepotPlaceId?: string | null;
  returningDepotLat?: number | null;
  returningDepotLng?: number | null;
  deliveryAddress1?: string | null;
  deliveryAddress2?: string | null;
  deliveryPostal?: string | null;
  deliveryPlaceId?: string | null;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
}): ReturnDestinationFields | null {
  const code = trimToNull(input.returningDepotCode);
  const depotAddress1 =
    trimToNull(input.returningDepotAddress1) ||
    (!code ? trimToNull(input.deliveryAddress1) : null);
  // Canonical depot selection must expose an address (combobox / master fill it).
  // Custom depot must supply a real address. Never invent from whitespace or code alone.
  const deliveryAddress1 = depotAddress1 || trimToNull(input.deliveryAddress1);
  if (!deliveryAddress1) return null;

  const useDepotSlot = Boolean(
    trimToNull(input.returningDepotAddress1) ||
      code ||
      trimToNull(input.returningDepotPostal) ||
      trimToNull(input.returningDepotPlaceId),
  );

  return {
    deliveryAddress1,
    deliveryAddress2: useDepotSlot
      ? trimToNull(input.returningDepotAddress2)
      : trimToNull(input.deliveryAddress2) ?? trimToNull(input.returningDepotAddress2),
    deliveryPostal: useDepotSlot
      ? trimToNull(input.returningDepotPostal)
      : trimToNull(input.deliveryPostal) ?? trimToNull(input.returningDepotPostal),
    deliveryPlaceId: useDepotSlot
      ? trimToNull(input.returningDepotPlaceId)
      : trimToNull(input.deliveryPlaceId) ?? trimToNull(input.returningDepotPlaceId),
    deliveryLat: useDepotSlot
      ? input.returningDepotLat ?? null
      : input.returningDepotLat ?? input.deliveryLat ?? null,
    deliveryLng: useDepotSlot
      ? input.returningDepotLng ?? null
      : input.returningDepotLng ?? input.deliveryLng ?? null,
    returningDepotCode: code,
    returningDepotAddress1: depotAddress1 ?? deliveryAddress1,
    returningDepotAddress2: useDepotSlot
      ? trimToNull(input.returningDepotAddress2)
      : trimToNull(input.returningDepotAddress2) ?? trimToNull(input.deliveryAddress2),
    returningDepotPostal: useDepotSlot
      ? trimToNull(input.returningDepotPostal)
      : trimToNull(input.returningDepotPostal) ?? trimToNull(input.deliveryPostal),
    returningDepotPlaceId: useDepotSlot
      ? trimToNull(input.returningDepotPlaceId)
      : trimToNull(input.returningDepotPlaceId) ?? trimToNull(input.deliveryPlaceId),
    returningDepotLat: useDepotSlot
      ? input.returningDepotLat ?? null
      : input.returningDepotLat ?? input.deliveryLat ?? null,
    returningDepotLng: useDepotSlot
      ? input.returningDepotLng ?? null
      : input.returningDepotLng ?? input.deliveryLng ?? null,
  };
}

/** Job create payload shape for an explicitly pending RETURN depot. */
export function pendingReturnDestinationJobFields(pendingText: string | null): {
  deliveryAddress1: string;
  deliveryAddress2: null;
  deliveryPostal: null;
  deliveryPlaceId: null;
  deliveryLat: null;
  deliveryLng: null;
  returningDepotCode: null;
  returningDepotAddress1: null;
  returningDepotAddress2: null;
  returningDepotPostal: null;
  returningDepotPlaceId: null;
  returningDepotLat: null;
  returningDepotLng: null;
  returningDepotPending: true;
  returningDepotPendingText: string | null;
} {
  return {
    deliveryAddress1: "",
    deliveryAddress2: null,
    deliveryPostal: null,
    deliveryPlaceId: null,
    deliveryLat: null,
    deliveryLng: null,
    returningDepotCode: null,
    returningDepotAddress1: null,
    returningDepotAddress2: null,
    returningDepotPostal: null,
    returningDepotPlaceId: null,
    returningDepotLat: null,
    returningDepotLng: null,
    returningDepotPending: true,
    returningDepotPendingText: trimToNull(pendingText),
  };
}

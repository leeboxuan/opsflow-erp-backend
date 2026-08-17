import { BadRequestException } from "@nestjs/common";
import { CollectionType, JobType } from "@prisma/client";

function isContainerCargoJobType(jobType: JobType): boolean {
  return (
    jobType === JobType.IMPORT
    || jobType === JobType.EXPORT
    || jobType === JobType.COLLECTION
  );
}

/** Accept `items` or FE alias `cargoItems`; default to [] when omitted. */
export function readCreateJobItemsInput(dto: {
  items?: unknown;
  cargoItems?: unknown;
}): unknown[] {
  const raw = dto.items ?? dto.cargoItems ?? [];
  return Array.isArray(raw) ? raw : [];
}

/** PATCH: only when `items` or `cargoItems` is present in the body (omit = leave unchanged). */
export function readUpdateJobItemsInput(dto: {
  items?: unknown;
  cargoItems?: unknown;
}): unknown[] | null {
  if (dto.items === undefined && dto.cargoItems === undefined) {
    return null;
  }
  return readCreateJobItemsInput(dto);
}

export function parseValidJobItemsFromInput(
  rawItems: unknown[],
  jobType?: JobType,
): Array<{
  itemCode: string;
  description: string | null;
  sealNo: string | null;
  pickupReference: string | null;
  qty: number | null;
}> {
  const containerStyle =
    jobType != null && isContainerCargoJobType(jobType);

  return rawItems
    .map((i: any) => {
      const itemCode = String(i?.itemCode ?? i?.containerNumber ?? "").trim();
      if (!itemCode) return null;
      const rawQty = i?.qty;
      let qty: number | null;
      if (containerStyle) {
        qty =
          rawQty == null || rawQty === ""
            ? null
            : Math.max(1, Number(rawQty) || 1);
      } else {
        qty = Math.max(1, Number(rawQty) || 1);
      }
      const sealNo =
        String(i?.sealNo ?? i?.sealNumber ?? "").trim() || null;
      // Container-style jobs: pickup reference + description are job-level only.
      // Do not persist per-item pickupReference/description on new writes.
      if (containerStyle) {
        return {
          itemCode,
          description: null,
          sealNo,
          pickupReference: null,
          qty,
        };
      }
      return {
        itemCode,
        description: i?.description?.trim() || null,
        sealNo,
        pickupReference: i?.pickupReference?.trim() || null,
        qty,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
}

export function parseValidUpdateJobItemsFromInput(
  rawItems: unknown[],
  jobType?: JobType,
): Array<
  ReturnType<typeof parseValidJobItemsFromInput>[number] & { id: string | null }
> {
  return rawItems.flatMap((rawItem) => {
    const parsed = parseValidJobItemsFromInput([rawItem], jobType);
    if (!parsed.length) return [];
    const id =
      rawItem && typeof rawItem === "object" && "id" in rawItem
        ? String((rawItem as { id?: unknown }).id ?? "").trim() || null
        : null;
    return [{ ...parsed[0], id }];
  });
}

export type AutocompleteLocationInput = {
  address1?: string | null;
  placeId?: string | null;
};

/** Address autocomplete: non-empty address line or Google place id. */
export function hasAutocompleteLocation(input: AutocompleteLocationInput): boolean {
  return !!(input.address1?.trim() || input.placeId?.trim());
}

export type ImportPickupSourceInput = {
  pickupPortCode?: string | null;
  pickupAddress1?: string | null;
  pickupPlaceId?: string | null;
};

export type ImportPickupOriginInput = {
  pickupAddress1?: string | null;
  pickupPlaceId?: string | null;
  pickupPostal?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
};

/**
 * IMPORT route origin: pickup address/geo fields take precedence over optional pickupPortCode metadata.
 */
export function importPickupOriginUsesAddressFields(
  input: ImportPickupOriginInput,
): boolean {
  return !!(
    input.pickupAddress1?.trim()
    || input.pickupPlaceId?.trim()
    || input.pickupPostal?.trim()
    || input.pickupLat != null
    || input.pickupLng != null
  );
}

/** @deprecated Use hasAutocompleteLocation for address-only pickup checks. */
export function hasImportPickupAddressSource(
  input: ImportPickupSourceInput,
): boolean {
  return hasAutocompleteLocation({
    address1: input.pickupAddress1,
    placeId: input.pickupPlaceId,
  });
}

export function assertPickupLocationForCreate(input: {
  jobType: JobType;
  pickupAddress1?: string | null;
  pickupPlaceId?: string | null;
  pickupPortCode?: string | null;
}): void {
  if (input.jobType === JobType.IMPORT && input.pickupPortCode?.trim()) {
    return;
  }
  if (
    hasAutocompleteLocation({
      address1: input.pickupAddress1,
      placeId: input.pickupPlaceId,
    })
  ) {
    return;
  }
  if (input.jobType === JobType.EXPORT) {
    // Empty-container depot is optional for EXPORT; create topology does not use it.
    return;
  }
  if (input.jobType === JobType.IMPORT) {
    throw new BadRequestException("Import port / terminal is required.");
  }
  throw new BadRequestException("Pickup location is required.");
}

export function assertDeliveryLocationForCreate(input: {
  jobType: JobType;
  deliveryAddress1?: string | null;
  deliveryPlaceId?: string | null;
  stuffingAddress1?: string | null;
}): void {
  const deliveryLine =
    input.stuffingAddress1?.trim() || input.deliveryAddress1?.trim() || null;
  if (
    hasAutocompleteLocation({
      address1: deliveryLine,
      placeId: input.deliveryPlaceId,
    })
  ) {
    return;
  }
  if (input.jobType === JobType.EXPORT) {
    throw new BadRequestException("Customer / stuffing location is required.");
  }
  if (input.jobType === JobType.IMPORT) {
    throw new BadRequestException("Customer / delivery location is required.");
  }
  throw new BadRequestException("Delivery location is required.");
}

/** Resolved EXPORT pickup address (top-level autocomplete preferred; legacy container fields as fallback). */
export function resolveExportPickupFields(input: {
  pickupAddress1?: string | null;
  pickupAddress2?: string | null;
  pickupPostal?: string | null;
  containerPickupAddress1?: string | null;
  containerPickupAddress2?: string | null;
  containerPickupPostal?: string | null;
}): { address1: string; address2: string | null; postal: string | null } {
  return {
    address1:
      input.pickupAddress1?.trim()
      || input.containerPickupAddress1?.trim()
      || "",
    address2:
      input.pickupAddress2?.trim()
      || input.containerPickupAddress2?.trim()
      || null,
    postal:
      input.pickupPostal?.trim()
      || input.containerPickupPostal?.trim()
      || null,
  };
}

export type ExportDestinationInput = {
  deliveryAddress1?: string | null;
  deliveryAddress2?: string | null;
  deliveryPostal?: string | null;
  stuffingAddress1?: string | null;
  stuffingAddress2?: string | null;
  stuffingPostal?: string | null;
};

/** When both top-level delivery and exportDetails stuffing fields are sent, they must agree. */
export function assertExportDestinationFieldsConsistent(
  input: ExportDestinationInput,
): void {
  const assertMatch = (
    stuffing: string | null | undefined,
    delivery: string | null | undefined,
    field: string,
  ) => {
    const s = stuffing?.trim();
    const d = delivery?.trim();
    if (s && d && s !== d) {
      throw new BadRequestException(
        `EXPORT ${field} must match exportDetails stuffing field when both are provided`,
      );
    }
  };
  assertMatch(input.stuffingAddress1, input.deliveryAddress1, "deliveryAddress1");
  assertMatch(input.stuffingAddress2, input.deliveryAddress2, "deliveryAddress2");
  assertMatch(input.stuffingPostal, input.deliveryPostal, "deliveryPostal");
}

/** Resolved EXPORT delivery/export destination (stuffing fields preferred, else top-level delivery). */
export function resolveExportDestinationFields(
  input: ExportDestinationInput,
): {
  address1: string | null;
  address2: string | null;
  postal: string | null;
} {
  return {
    address1:
      input.stuffingAddress1?.trim()
      || input.deliveryAddress1?.trim()
      || null,
    address2:
      input.stuffingAddress2?.trim()
      || input.deliveryAddress2?.trim()
      || null,
    postal:
      input.stuffingPostal?.trim() || input.deliveryPostal?.trim() || null,
  };
}

/** IMPORT create: pickupPortCode (optional metadata) or autocomplete pickup fields. */
export function assertImportPickupSourceForCreate(
  input: ImportPickupSourceInput,
): void {
  assertPickupLocationForCreate({
    jobType: JobType.IMPORT,
    pickupAddress1: input.pickupAddress1,
    pickupPlaceId: input.pickupPlaceId,
    pickupPortCode: input.pickupPortCode,
  });
}

/** COLLECTION create requires EMPTY or LOADED; other job types store null. */
export function resolveCollectionTypeForJobCreate(
  jobType: JobType,
  collectionType?: CollectionType | string | null,
): CollectionType | null {
  if (jobType !== JobType.COLLECTION) return null;
  const raw =
    typeof collectionType === "string"
      ? collectionType.trim().toUpperCase()
      : collectionType;
  if (raw === CollectionType.EMPTY || raw === CollectionType.LOADED) {
    return raw;
  }
  throw new BadRequestException(
    "collectionType is required for COLLECTION jobs (EMPTY or LOADED)",
  );
}

export function assertCreateJobItemsRequiredForJobType(
  _jobType: JobType,
  rawItems: unknown[],
  validItems: Array<{ itemCode: string }>,
): void {
  if (!rawItems.length) {
    return;
  }
  if (!validItems.length) {
    throw new BadRequestException(
      "At least one valid item is required when items are provided",
    );
  }
}

export type ParsedCreateJobItem = ReturnType<typeof parseValidJobItemsFromInput>[number];

/**
 * Match persisted JobItems back to submitted container/item order by identity.
 * Duplicate (itemCode, sealNo) rows are allowed on a Job; canonical create instead
 * persists JobItems sequentially in submit order and uses positional IDs directly.
 */
export function orderCreatedJobItemIdsBySubmitOrder(
  submittedItems: ParsedCreateJobItem[],
  createdItems: Array<{ id: string; itemCode: string; sealNo?: string | null }>,
): string[] {
  const remaining = createdItems.map((item) => ({ ...item }));
  return submittedItems.map((submitted) => {
    const matchIndex = remaining.findIndex(
      (created) =>
        created.itemCode === submitted.itemCode
        && (created.sealNo ?? null) === (submitted.sealNo ?? null),
    );
    if (matchIndex < 0) {
      throw new BadRequestException(
        "Created JobItem rows could not be matched to submitted container order",
      );
    }
    const [matched] = remaining.splice(matchIndex, 1);
    return matched.id;
  });
}

/**
 * COLLECTION auto-trip count uses only parsed container cargo rows.
 * `parseValidJobItemsFromInput` already drops blank rows and requires itemCode/containerNumber.
 */
export function collectionContainerCountForTripGeneration(
  jobType: JobType,
  validItems: ParsedCreateJobItem[],
): number | undefined {
  if (jobType !== JobType.COLLECTION) return undefined;
  return validItems.length;
}

/**
 * Phase 1 TripJobItem M:N linkage helpers.
 *
 * TripJobItem is the sole source of truth for which JobItems (containers) a trip owns.
 * Every link is implicitly verified (created via ordinary create/publish/update flows).
 * Trip.containerNumber is a display cache only — never use it for cargo auth,
 * document scope, completion, or reporting.
 */

import {
  JobTripTemplate,
  JobType,
  TripStatus,
  type Prisma,
} from "@prisma/client";
import {
  canonicalAutoTripCarriesCreatedJobItems,
  isContainerCargoJobType,
} from "../workflows/job-workflow.helpers";

export type LinkedCargoItemDto = {
  id: string;
  jobItemId: string;
  containerNumber: string | null;
  sealNo: string | null;
  sealNumber: string | null;
  pickupReference: string | null;
  containerSize: null;
  weight: null;
  remarks: null;
  description?: string | null;
  qty?: number | null;
  itemCode?: string | null;
};

export type TripJobItemLinkRow = {
  id: string;
  jobItemId: string;
  containerNumberSnapshot: string | null;
  jobItem: {
    id: string;
    itemCode: string;
    description: string | null;
    sealNo: string | null;
    pickupReference: string | null;
    qty: number | null;
  };
};

export type JobItemRowForLink = {
  id: string;
  itemCode: string;
  description?: string | null;
  sealNo?: string | null;
  pickupReference?: string | null;
  qty?: number | null;
  jobId?: string;
  tenantId?: string;
};

/** Container-based transport job that requires TripJobItem links for publish/docs/complete. */
export function isContainerBasedTransportJob(
  jobType: JobType | null | undefined,
  itemCount: number,
): boolean {
  return isContainerCargoJobType(jobType as JobType) && itemCount > 0;
}

/** COMPLETED / DONE freeze ordinary TripJobItem create/replace/delete. */
export function isTripJobItemLinkFrozen(
  status: TripStatus | string | null | undefined,
): boolean {
  return status === TripStatus.COMPLETED || status === TripStatus.DONE;
}

export function assertTripJobItemMutable(
  status: TripStatus | string | null | undefined,
): void {
  if (isTripJobItemLinkFrozen(status)) {
    throw new Error(
      "TripJobItem links are frozen for COMPLETED/DONE trips and cannot be created, replaced, or deleted",
    );
  }
}

/** Mirror rules for Trip.containerNumber cache after link mutation. */
export function resolveSyncedTripContainerNumber(
  linkedItems: Array<{ itemCode?: string | null }>,
  previousContainerNumber?: string | null,
): string | null {
  if (linkedItems.length === 0) {
    // Compat: leave unchanged when already set; otherwise null.
    const prev = String(previousContainerNumber ?? "").trim();
    return prev || null;
  }
  if (linkedItems.length === 1) {
    return String(linkedItems[0]?.itemCode ?? "").trim() || null;
  }
  return null;
}

export function mapLinkedCargoContainers(
  links: TripJobItemLinkRow[],
): LinkedCargoItemDto[] {
  return links.map((link) => {
    const sealNo = link.jobItem.sealNo ?? null;
    const containerNumber =
      String(link.jobItem.itemCode ?? "").trim()
      || String(link.containerNumberSnapshot ?? "").trim()
      || null;
    return {
      id: link.jobItemId,
      jobItemId: link.jobItemId,
      containerNumber,
      sealNo,
      sealNumber: sealNo,
      pickupReference: null,
      containerSize: null,
      weight: null,
      remarks: null,
      itemCode: link.jobItem.itemCode,
      description: link.jobItem.description ?? null,
      qty: link.jobItem.qty ?? null,
    };
  });
}

export function mapLinkedCargoItemsMode(
  links: TripJobItemLinkRow[],
): Array<{
  id: string;
  jobItemId: string;
  itemCode: string | null;
  description: string | null;
  quantity: number | null;
  qty: number | null;
  uom: null;
  weight: null;
  volume: null;
  remarks: null;
}> {
  return links.map((link) => ({
    id: link.jobItemId,
    jobItemId: link.jobItemId,
    itemCode: link.jobItem.itemCode ?? null,
    description: link.jobItem.description ?? null,
    quantity: link.jobItem.qty ?? null,
    qty: link.jobItem.qty ?? null,
    uom: null,
    weight: null,
    volume: null,
    remarks: null,
  }));
}

/**
 * Build cargo payload for trip detail / driver detail.
 * Container jobs: TripJobItem links only (empty when unlinked — never invent all JobItems).
 * LCL: when no links, show job items as ITEMS for operational display (LCL does not require TripJobItem).
 */
export function buildTripCargoFromLinks(input: {
  jobType: JobType | null | undefined;
  links: TripJobItemLinkRow[];
  /** All job items — used only for LCL display without links. */
  allJobItems?: JobItemRowForLink[];
}): {
  mode: "CONTAINER" | "ITEMS";
  containers?: LinkedCargoItemDto[];
  items?: ReturnType<typeof mapLinkedCargoItemsMode>;
  cargoSource: "TRIP_JOB_ITEM" | "EMPTY";
} {
  const isContainer = isContainerCargoJobType(input.jobType as JobType);

  if (input.links.length > 0) {
    if (isContainer) {
      return {
        mode: "CONTAINER",
        containers: mapLinkedCargoContainers(input.links),
        cargoSource: "TRIP_JOB_ITEM",
      };
    }
    return {
      mode: "ITEMS",
      items: mapLinkedCargoItemsMode(input.links),
      cargoSource: "TRIP_JOB_ITEM",
    };
  }

  // LCL with no links: show job items as ITEMS for operational display (LCL does not require TripJobItem).
  if (!isContainer && (input.allJobItems?.length ?? 0) > 0) {
    const syntheticLinks: TripJobItemLinkRow[] = (input.allJobItems ?? []).map((item) => ({
      id: `lcl-display-${item.id}`,
      jobItemId: item.id,
      containerNumberSnapshot: null,
      jobItem: {
        id: item.id,
        itemCode: item.itemCode,
        description: item.description ?? null,
        sealNo: item.sealNo ?? null,
        pickupReference: item.pickupReference ?? null,
        qty: item.qty ?? null,
      },
    }));
    return {
      mode: "ITEMS",
      items: mapLinkedCargoItemsMode(syntheticLinks),
      cargoSource: "EMPTY",
    };
  }

  if (isContainer) {
    return { mode: "CONTAINER", containers: [], cargoSource: "EMPTY" };
  }
  return { mode: "ITEMS", items: [], cargoSource: "EMPTY" };
}

export function normalizeJobItemIdsInput(
  raw: unknown,
): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const id = String(value ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Publish link readiness for container-based trips.
 * LCL / zero items: not required.
 * Single job item: may auto-heal (caller creates link).
 * Multi item: requires ≥1 existing TripJobItem (or explicit jobItemIds already applied).
 */
export type TripPublishLinkReadiness = {
  required: boolean;
  satisfied: boolean;
  shouldAutoHealSingleItem: boolean;
  singleJobItemId: string | null;
  errorMessage: string | null;
};

export function evaluateTripPublishLinkReadiness(input: {
  jobType: JobType | null | undefined;
  jobItemCount: number;
  linkedJobItemCount: number;
  jobItemIds?: string[];
  jobTripTemplate?: JobTripTemplate | null;
}): TripPublishLinkReadiness {
  if (!isContainerBasedTransportJob(input.jobType, input.jobItemCount)) {
    return {
      required: false,
      satisfied: true,
      shouldAutoHealSingleItem: false,
      singleJobItemId: null,
      errorMessage: null,
    };
  }

  if (
    input.jobType
    && !canonicalAutoTripCarriesCreatedJobItems(
      input.jobType,
      input.jobTripTemplate,
    )
  ) {
    return {
      required: false,
      satisfied: true,
      shouldAutoHealSingleItem: false,
      singleJobItemId: null,
      errorMessage: null,
    };
  }

  if (input.linkedJobItemCount >= 1) {
    return {
      required: true,
      satisfied: true,
      shouldAutoHealSingleItem: false,
      singleJobItemId: null,
      errorMessage: null,
    };
  }

  if (input.jobItemCount === 1) {
    const singleId = input.jobItemIds?.[0] ?? null;
    return {
      required: true,
      satisfied: false,
      shouldAutoHealSingleItem: !!singleId,
      singleJobItemId: singleId,
      errorMessage: singleId
        ? null
        : "Container-based trip requires at least one linked cargo item before publish.",
    };
  }

  return {
    required: true,
    satisfied: false,
    shouldAutoHealSingleItem: false,
    singleJobItemId: null,
    errorMessage:
      "Select at least one cargo item (jobItemIds) before publishing this container-based trip.",
  };
}

export type DriverListCargoSource =
  | "TRIP_JOB_ITEM"
  | "EMPTY"
  | "LEGACY_TRIP_CONTAINER";

export type DriverListCargoSummary = {
  cargoSource: DriverListCargoSource;
  /** Canonical linked cargo label for driver list cards. */
  cargoSummary: string | null;
  /**
   * Display-only. Single linked itemCode, else cached Trip.containerNumber.
   * Never use for authorization, uploads, completion, or cargo mutation.
   */
  containerNumber: string | null;
};

/**
 * List-card cargo from explicit TripJobItem links only.
 * Does not infer unlinked job items (including LCL — that fallback is detail-only).
 */
export function summarizeLinkedCargoForDriverList(input: {
  tenantId: string;
  jobType?: JobType | string | null;
  tripJobItems?: Array<{
    tenantId?: string | null;
    containerNumberSnapshot?: string | null;
    jobItem?: {
      tenantId?: string | null;
      itemCode?: string | null;
    } | null;
  }> | null;
  legacyContainerNumber?: string | null;
}): DriverListCargoSummary {
  const tenantId = String(input.tenantId ?? "").trim();
  const links = (input.tripJobItems ?? []).filter((link) => {
    if (!tenantId) return false;
    if (link.tenantId && link.tenantId !== tenantId) return false;
    if (link.jobItem?.tenantId && link.jobItem.tenantId !== tenantId) return false;
    return true;
  });

  const codes = links
    .map((link) => {
      const live = String(link.jobItem?.itemCode ?? "").trim();
      if (live) return live;
      return String(link.containerNumberSnapshot ?? "").trim();
    })
    .filter((code) => code.length > 0);

  if (links.length > 0) {
    const isContainer = isContainerCargoJobType(input.jobType as JobType);
    const summary =
      codes.length === 1
        ? codes[0]
        : codes.length > 1 && codes.length <= 3
          ? codes.join(", ")
          : codes.length > 3
            ? `${codes.length} ${isContainer ? "containers" : "items"}`
            : null;
    return {
      cargoSource: "TRIP_JOB_ITEM",
      cargoSummary: summary,
      containerNumber: codes.length === 1 ? codes[0] : null,
    };
  }

  const legacy = String(input.legacyContainerNumber ?? "").trim();
  if (legacy) {
    return {
      cargoSource: "LEGACY_TRIP_CONTAINER",
      cargoSummary: null,
      containerNumber: legacy,
    };
  }

  return {
    cargoSource: "EMPTY",
    cargoSummary: null,
    containerNumber: null,
  };
}

/** Prisma include for TripJobItem with job item fields used by cargo DTO. */
export const tripJobItemWithJobItemInclude = {
  jobItem: {
    select: {
      id: true,
      itemCode: true,
      description: true,
      sealNo: true,
      pickupReference: true,
      qty: true,
    },
  },
} satisfies Prisma.TripJobItemInclude;

export type TripJobItemCreateManyRow = {
  tenantId: string;
  tripId: string;
  jobItemId: string;
  containerNumberSnapshot: string | null;
  linkedByUserId: string | null;
};

export function buildTripJobItemCreateRows(input: {
  tenantId: string;
  tripId: string;
  items: JobItemRowForLink[];
  linkedByUserId?: string | null;
}): TripJobItemCreateManyRow[] {
  return input.items.map((item) => ({
    tenantId: input.tenantId,
    tripId: input.tripId,
    jobItemId: item.id,
    containerNumberSnapshot: String(item.itemCode ?? "").trim() || null,
    linkedByUserId: input.linkedByUserId ?? null,
  }));
}

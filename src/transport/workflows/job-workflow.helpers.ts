import {
  JobTripTemplate,
  JobType,
  Prisma,
  TripDocumentType,
  TripPendingState,
  TripStatus,
} from "@prisma/client";
import { GUL_CIRCLE_LOCATION } from "./gul-circle-location";
import type { TripDocumentRequirementSnapshot } from "./trip-document-requirements";
import {
  buildTripCompletionDocumentGapsFromEvaluation,
  PHOTO_DOCUMENTATION_MISSING_KEY as EVAL_PHOTO_MISSING_KEY,
  PHOTO_DOCUMENTATION_SATISFYING_TYPES as EVAL_PHOTO_TYPES,
} from "./trip-document-requirement-evaluation";

export type TripCompletionRule = {
  requireGeneratedDoSigned: boolean;
  tripUploads: {
    minUploadCount: number;
    allowedUploadTypes: TripDocumentType[];
    /** Optional stricter mode: every type in this list must exist at least once. */
    requiredUploadTypesExact?: TripDocumentType[];
  };
};

// Explicit, per-template completion rules.
// Extend by adding new JobTripTemplate keys here.
export const TRIP_COMPLETION_RULES: Record<JobTripTemplate, TripCompletionRule> = {
  [JobTripTemplate.PICKUP_TO_DELIVERY]: {
    requireGeneratedDoSigned: true,
    tripUploads: {
      minUploadCount: 2,
      allowedUploadTypes: [TripDocumentType.PICKUP_DO, TripDocumentType.POD_SIGNATURE],
      requiredUploadTypesExact: [
        TripDocumentType.PICKUP_DO,
        TripDocumentType.POD_SIGNATURE,
      ],
    },
  },
  [JobTripTemplate.DELIVERY_TO_DEPOT]: {
    requireGeneratedDoSigned: true,
    tripUploads: {
      minUploadCount: 1,
      allowedUploadTypes: [TripDocumentType.PICKUP_DO],
      requiredUploadTypesExact: [TripDocumentType.PICKUP_DO],
    },
  },
  [JobTripTemplate.DEPOT_TO_DELIVERY]: {
    requireGeneratedDoSigned: true,
    tripUploads: {
      minUploadCount: 2,
      allowedUploadTypes: [TripDocumentType.PICKUP_DO, TripDocumentType.POD_SIGNATURE],
      requiredUploadTypesExact: [
        TripDocumentType.PICKUP_DO,
        TripDocumentType.POD_SIGNATURE,
      ],
    },
  },
  [JobTripTemplate.DELIVERY_TO_PORT]: {
    requireGeneratedDoSigned: true,
    tripUploads: {
      minUploadCount: 1,
      allowedUploadTypes: [TripDocumentType.POD_SIGNATURE],
      requiredUploadTypesExact: [TripDocumentType.POD_SIGNATURE],
    },
  },
  [JobTripTemplate.PORT_TO_DEPOT]: {
    requireGeneratedDoSigned: true,
    tripUploads: {
      minUploadCount: 1,
      allowedUploadTypes: [TripDocumentType.PICKUP_DO],
      requiredUploadTypesExact: [TripDocumentType.PICKUP_DO],
    },
  },
  [JobTripTemplate.CUSTOMER_TO_GUL]: {
    requireGeneratedDoSigned: true,
    tripUploads: {
      minUploadCount: 1,
      allowedUploadTypes: [TripDocumentType.PICKUP_DO, TripDocumentType.POD_SIGNATURE],
    },
  },
  [JobTripTemplate.GUL_TO_CUSTOMER]: {
    requireGeneratedDoSigned: true,
    tripUploads: {
      minUploadCount: 1,
      allowedUploadTypes: [TripDocumentType.PICKUP_DO, TripDocumentType.POD_SIGNATURE],
    },
  },
  [JobTripTemplate.CUSTOM]: {
    requireGeneratedDoSigned: true,
    tripUploads: {
      minUploadCount: 1,
      allowedUploadTypes: [TripDocumentType.PICKUP_DO, TripDocumentType.POD_SIGNATURE],
    },
  },
};

/** Fixed 7 Gul Circle snapshot for Gul Circle trip templates (see gul-circle-location.ts). */
export const GUL_CIRCLE_ROUTE_DEFAULTS = {
  label: GUL_CIRCLE_LOCATION.label,
  summary: GUL_CIRCLE_LOCATION.label,
  addressLine1: GUL_CIRCLE_LOCATION.addressLine1,
  postalCode: GUL_CIRCLE_LOCATION.postalCode,
  country: GUL_CIRCLE_LOCATION.country,
  lat: GUL_CIRCLE_LOCATION.lat,
  lng: GUL_CIRCLE_LOCATION.lng,
  placeId: GUL_CIRCLE_LOCATION.placeId,
} as const;

export type AppendTripRouteInput = {
  originSummary?: string | null;
  destinationSummary?: string | null;
  originAddress1?: string | null;
  originAddress2?: string | null;
  destinationAddress1?: string | null;
  destinationAddress2?: string | null;
  originPostalCode?: string | null;
  destinationPostalCode?: string | null;
  originPlaceId?: string | null;
  destinationPlaceId?: string | null;
  originLat?: number | null;
  originLng?: number | null;
  destinationLat?: number | null;
  destinationLng?: number | null;
};

export type ResolvedAppendTripRouteSnapshot = {
  originLabel: string | null;
  destinationLabel: string | null;
  originAddressLine1: string | null;
  originAddressLine2: string | null;
  destinationAddressLine1: string | null;
  destinationAddressLine2: string | null;
  originPostalCode: string | null;
  destinationPostalCode: string | null;
  originCountry: string | null;
  destinationCountry: string | null;
  originPlaceId: string | null;
  destinationPlaceId: string | null;
  originLat: number | null;
  originLng: number | null;
  destinationLat: number | null;
  destinationLng: number | null;
};

function normalizeOptionalAddressField(
  value?: string | null,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolvePrimaryAddressLine(
  address1?: string | null,
  summary?: string | null,
): string | null {
  return (
    normalizeOptionalAddressField(address1)
    ?? normalizeOptionalAddressField(summary)
  );
}

/** Flat trip route address fields for API responses (add trip, list, detail, mobile). */
export function resolveTripRouteAddressResponseFields(trip: {
  originAddressLine1?: string | null;
  originAddressLine2?: string | null;
  originPostalCode?: string | null;
  originPlaceId?: string | null;
  originLat?: number | null;
  originLng?: number | null;
  destinationAddressLine1?: string | null;
  destinationAddressLine2?: string | null;
  destinationPostalCode?: string | null;
  destinationPlaceId?: string | null;
  destinationLat?: number | null;
  destinationLng?: number | null;
} | null | undefined): {
  originAddress1: string | null;
  originAddress2: string | null;
  originPostalCode: string | null;
  originPlaceId: string | null;
  originLat: number | null;
  originLng: number | null;
  destinationAddress1: string | null;
  destinationAddress2: string | null;
  destinationPostalCode: string | null;
  destinationPlaceId: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
} {
  return {
    originAddress1: trip?.originAddressLine1 ?? null,
    originAddress2: trip?.originAddressLine2 ?? null,
    originPostalCode: trip?.originPostalCode ?? null,
    originPlaceId: trip?.originPlaceId ?? null,
    originLat: trip?.originLat ?? null,
    originLng: trip?.originLng ?? null,
    destinationAddress1: trip?.destinationAddressLine1 ?? null,
    destinationAddress2: trip?.destinationAddressLine2 ?? null,
    destinationPostalCode: trip?.destinationPostalCode ?? null,
    destinationPlaceId: trip?.destinationPlaceId ?? null,
    destinationLat: trip?.destinationLat ?? null,
    destinationLng: trip?.destinationLng ?? null,
  };
}

/** Resolve route snapshot for append-trip, including map-ready Gul Circle defaults. */
export function resolveAppendTripRouteSnapshot(
  template: JobTripTemplate,
  dto: AppendTripRouteInput,
): ResolvedAppendTripRouteSnapshot {
  const g = GUL_CIRCLE_ROUTE_DEFAULTS;
  let originLabel = resolvePrimaryAddressLine(
    dto.originAddress1,
    dto.originSummary,
  );
  let destinationLabel = resolvePrimaryAddressLine(
    dto.destinationAddress1,
    dto.destinationSummary,
  );
  let originAddressLine1 = originLabel;
  let destinationAddressLine1 = destinationLabel;
  let originAddressLine2 = normalizeOptionalAddressField(dto.originAddress2);
  let destinationAddressLine2 = normalizeOptionalAddressField(
    dto.destinationAddress2,
  );
  let originPostalCode = dto.originPostalCode?.trim() || null;
  let destinationPostalCode = dto.destinationPostalCode?.trim() || null;
  let originCountry: string | null = originLabel ? "SG" : null;
  let destinationCountry: string | null = destinationLabel ? "SG" : null;
  let originPlaceId = dto.originPlaceId?.trim() || null;
  let destinationPlaceId = dto.destinationPlaceId?.trim() || null;
  let originLat = dto.originLat ?? null;
  let originLng = dto.originLng ?? null;
  let destinationLat = dto.destinationLat ?? null;
  let destinationLng = dto.destinationLng ?? null;

  if (template === JobTripTemplate.CUSTOMER_TO_GUL) {
    if (!destinationLabel) destinationLabel = g.label;
    if (!destinationAddressLine1) destinationAddressLine1 = g.addressLine1;
    if (!destinationPostalCode) destinationPostalCode = g.postalCode;
    destinationCountry = g.country;
    destinationLat = g.lat;
    destinationLng = g.lng;
  } else if (template === JobTripTemplate.GUL_TO_CUSTOMER) {
    if (!originLabel) originLabel = g.label;
    if (!originAddressLine1) originAddressLine1 = g.addressLine1;
    if (!originPostalCode) originPostalCode = g.postalCode;
    originCountry = g.country;
    originLat = g.lat;
    originLng = g.lng;
  }

  return {
    originLabel,
    destinationLabel,
    originAddressLine1,
    originAddressLine2,
    destinationAddressLine1,
    destinationAddressLine2,
    originPostalCode,
    destinationPostalCode,
    originCountry,
    destinationCountry,
    originPlaceId,
    destinationPlaceId,
    originLat,
    originLng,
    destinationLat,
    destinationLng,
  };
}

export function jobTripTemplateDisplayLabel(template: JobTripTemplate): string {
  switch (template) {
    case JobTripTemplate.PICKUP_TO_DELIVERY:
      return "Pickup → Delivery";
    case JobTripTemplate.DELIVERY_TO_DEPOT:
      return "Delivery → Depot";
    case JobTripTemplate.DEPOT_TO_DELIVERY:
      return "Depot → Delivery";
    case JobTripTemplate.DELIVERY_TO_PORT:
      return "Delivery → Port";
    case JobTripTemplate.PORT_TO_DEPOT:
      return "Port → Depot";
    case JobTripTemplate.CUSTOMER_TO_GUL:
      return "Customer → Gul Circle";
    case JobTripTemplate.GUL_TO_CUSTOMER:
      return "Gul Circle → Customer";
    case JobTripTemplate.CUSTOM:
      return "Custom";
    default:
      return template;
  }
}

/** Default JSON rule checked by driver trip completion (see DriverJobsService). */
export function completionRuleForTemplate(
  template: JobTripTemplate,
): Prisma.InputJsonValue {
  const rule = TRIP_COMPLETION_RULES[template] ?? TRIP_COMPLETION_RULES[JobTripTemplate.CUSTOM];
  return {
    requireGeneratedDoSigned: rule.requireGeneratedDoSigned,
    tripUploads: {
      minUploadCount: rule.tripUploads.minUploadCount,
      allowedUploadTypes: [...rule.tripUploads.allowedUploadTypes],
      ...(rule.tripUploads.requiredUploadTypesExact?.length
        ? {
            requiredUploadTypesExact: [...rule.tripUploads.requiredUploadTypesExact],
          }
        : {}),
    },
  };
}

export type ResolvedTripCompletionRule = {
  requireGeneratedDoSigned: boolean;
  minUploadCount: number;
  allowedUploadTypes: TripDocumentType[];
  requiredUploadTypesExact: TripDocumentType[];
};

const TRIP_DOC_TYPES = new Set<string>(Object.values(TripDocumentType));

function toTripDocTypeList(value: unknown): TripDocumentType[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is TripDocumentType => typeof v === "string" && TRIP_DOC_TYPES.has(v),
  );
}

/**
 * Supports both legacy and v2 completion rule formats.
 */
export function resolveTripCompletionRule(raw: unknown): ResolvedTripCompletionRule {
  const rule = (raw ?? {}) as Record<string, unknown>;
  const requireGeneratedDoSigned = Boolean(rule.requireGeneratedDoSigned);
  const v2 = rule.tripUploads as Record<string, unknown> | undefined;

  const allowedFromV2 = toTripDocTypeList(v2?.allowedUploadTypes);
  const exactFromV2 = toTripDocTypeList(v2?.requiredUploadTypesExact);
  const legacyRequired = toTripDocTypeList(rule.requiredTripUploadTypes);

  const allowedUploadTypes =
    allowedFromV2.length > 0
      ? allowedFromV2
      : legacyRequired.length > 0
        ? legacyRequired
        : [];

  const requiredUploadTypesExact =
    exactFromV2.length > 0
      ? exactFromV2
      : legacyRequired.length > 0
        ? legacyRequired
        : [];

  const minFromV2 = Number(v2?.minUploadCount);
  const minUploadCount =
    Number.isFinite(minFromV2) && minFromV2 > 0
      ? Math.floor(minFromV2)
      : requiredUploadTypesExact.length > 0
        ? requiredUploadTypesExact.length
        : 0;

  return {
    requireGeneratedDoSigned,
    minUploadCount,
    allowedUploadTypes,
    requiredUploadTypesExact,
  };
}

/** Canonical missing key returned to mobile for photo documentation gaps. */
export const PHOTO_DOCUMENTATION_MISSING_KEY = EVAL_PHOTO_MISSING_KEY;

/** Active trip document types that satisfy the photo documentation requirement. */
export const PHOTO_DOCUMENTATION_SATISFYING_TYPES: TripDocumentType[] =
  EVAL_PHOTO_TYPES as TripDocumentType[];

export type TripCompletionDocRow = {
  type: TripDocumentType;
  signedAt: Date | null;
  isSigned: boolean;
  isActive?: boolean | null;
  mimeType?: string | null;
  originalName?: string | null;
  fileName?: string | null;
};

/**
 * Canonical live completion rules (web chips, mobile checklist, completeTrip,
 * and Statistics missing-docs exceptions must agree):
 *
 * When TripDocumentRequirement snapshots exist, those rows are the source of
 * truth (isRequired / requiresSignature / minCount / stage / uploader).
 * Container/seal remain per-TripJobItem outside this helper.
 */
export const CANONICAL_COMPLETION_RULES = {
  requiredPhotoTypes: PHOTO_DOCUMENTATION_SATISFYING_TYPES,
  requiredSignedDeliveryDoIfPresent: true,
  pickupDoEnforced: false,
  podSignatureEnforced: false,
  parkingCodeBlocksCompletion: false,
} as const;

/**
 * Driver trip completion document gaps (BEFORE_COMPLETE stage).
 * Delegates to evaluateTripDocumentRequirements so minCount, signatures,
 * inactive docs, and Delivery DO missing-state stay consistent everywhere.
 */
export function buildTripCompletionDocumentGaps(
  docs: TripCompletionDocRow[],
  requirements?: TripDocumentRequirementSnapshot[] | null,
  tripStatus?: string | null,
): string[] {
  return buildTripCompletionDocumentGapsFromEvaluation(
    docs.map((document) => ({
      type: document.type,
      signedAt: document.signedAt ?? null,
      isSigned: document.isSigned === true,
      isActive: document.isActive !== false,
      mimeType: document.mimeType ?? null,
      originalName: document.originalName ?? null,
      fileName: document.fileName ?? null,
    })),
    requirements,
    tripStatus,
  );
}

/** Trailer checkout fields that block completion (parking code is advisory only). */
export function trailerCheckoutBlocksCompletion(
  requiresTrailerCheckout: boolean,
  missingTrailerCheckoutFields: string[],
): boolean {
  if (!requiresTrailerCheckout) return false;
  return missingTrailerCheckoutFields.some(
    (field) => field !== "trailerParkingLocationCode",
  );
}

/** Job types whose trip detail cargo is exposed as CONTAINER (not item/qty lines). */
export function isContainerCargoJobType(jobType: JobType): boolean {
  return (
    jobType === JobType.IMPORT
    || jobType === JobType.EXPORT
    || jobType === JobType.COLLECTION
    || jobType === JobType.RETURN
    || jobType === JobType.ONE_WAY
  );
}

export type DefaultTripSeed = {
  jobSequence: number;
  tripSequence: number;
  displayTitle: string;
  jobTripTemplate: JobTripTemplate;
  title: string;
  plannedStartAt: Date | null;
};

export type TripCreateManyForJobOptions = {
  createdByUserId?: string | null;
  /** COLLECTION only: one Pickup→Delivery trip per container JobItem (0 → one empty leg). */
  collectionContainerCount?: number;
  /** Phase 4: set when topology is unambiguous (exactly one job type). */
  tripType?: JobType | null;
};

/**
 * Canonical auto-trip templates for every Job create channel
 * (manual Create Job, AI / WhatsApp reviewed import, Excel, future intake).
 *
 * Sequences are 1-based and contiguous. Do not branch by intake channel.
 *
 * - EXPORT: Customer → Port
 * - IMPORT: Port → Customer, Customer → Depot
 * - LCL: Pickup → Delivery
 * - COLLECTION: Pickup → Delivery — one trip per container JobItem (or one leg when no items)
 * - ONE_WAY: Pickup → Delivery (prime-mover container haul)
 * - RETURN: Pickup → Depot (prime-mover container return)
 */
export const CANONICAL_AUTO_TRIP_TEMPLATES: Record<
  JobType,
  JobTripTemplate[]
> = {
  // EXPORT: stuffed container Customer/Stuffing → Export Port only.
  // Empty-container collection is not an OpsFlow Trip.
  [JobType.EXPORT]: [JobTripTemplate.DELIVERY_TO_PORT],
  [JobType.IMPORT]: [
    JobTripTemplate.PICKUP_TO_DELIVERY,
    JobTripTemplate.DELIVERY_TO_DEPOT,
  ],
  [JobType.LCL]: [JobTripTemplate.PICKUP_TO_DELIVERY],
  [JobType.COLLECTION]: [JobTripTemplate.PICKUP_TO_DELIVERY],
  [JobType.ONE_WAY]: [JobTripTemplate.PICKUP_TO_DELIVERY],
  [JobType.RETURN]: [JobTripTemplate.PICKUP_TO_DELIVERY],
};

/**
 * Cargo-movement model for canonical auto-trips (`TripJobItem`).
 *
 * Do not cartesian-link every JobItem onto every auto-leg. Same JobItem on
 * multiple legs means the same cargo actually moves on each of those legs.
 *
 * IMPORT — each created container JobItem on both legs:
 *   1. Port → Customer (`PICKUP_TO_DELIVERY`) — laden
 *   2. Customer → Depot (`DELIVERY_TO_DEPOT`) — empty return of the same boxes
 *
 * EXPORT — each created container JobItem on the single laden leg:
 *   1. Customer → Port (`DELIVERY_TO_PORT`) — stuffed export box to terminal
 * Historical EXPORT `PORT_TO_DEPOT` rows (pre one-Trip topology) still do not
 * auto-carry create-time JobItems when evaluated via this helper.
 *
 * LCL / ONE_WAY — all created JobItems on the single Pickup → Delivery trip.
 *
 * RETURN — all created JobItems on the single Pickup → Depot trip.
 *
 * COLLECTION — one container JobItem per Pickup → Delivery trip (same route on each leg).
 */
export function canonicalAutoTripCarriesCreatedJobItems(
  jobType: JobType,
  jobTripTemplate: JobTripTemplate | null | undefined,
): boolean {
  if (jobType === JobType.EXPORT && jobTripTemplate === JobTripTemplate.PORT_TO_DEPOT) {
    return false;
  }
  return true;
}

export function collectionAutoTripCount(containerCount: number): number {
  return containerCount > 0 ? containerCount : 1;
}

export function jobItemIdsForCanonicalAutoTrip(input: {
  jobType: JobType;
  jobTripTemplate: JobTripTemplate | null | undefined;
  jobItemIds: string[];
  tripSequence?: number;
}): string[] {
  if (
    !canonicalAutoTripCarriesCreatedJobItems(
      input.jobType,
      input.jobTripTemplate,
    )
  ) {
    return [];
  }
  if (input.jobType === JobType.COLLECTION && input.jobItemIds.length > 1) {
    const index = Math.max(0, (input.tripSequence ?? 1) - 1);
    const jobItemId = input.jobItemIds[index];
    return jobItemId ? [jobItemId] : [];
  }
  return input.jobItemIds;
}

const CANONICAL_AUTO_TRIP_TITLES: Record<JobType, string[]> = {
  [JobType.EXPORT]: ["Customer to Port"],
  [JobType.IMPORT]: ["Port to Customer", "Customer to Depot"],
  [JobType.LCL]: ["Pickup to Delivery"],
  [JobType.COLLECTION]: ["Pickup to Delivery"],
  [JobType.ONE_WAY]: ["Pickup to Delivery"],
  [JobType.RETURN]: ["Pickup to Depot"],
};

function buildCollectionTripSeeds(
  pickupDate: Date | null,
  containerCount: number,
): DefaultTripSeed[] {
  const tripCount = collectionAutoTripCount(containerCount);
  const title = "Pickup to Delivery";
  return Array.from({ length: tripCount }, (_, index) => {
    const sequence = index + 1;
    return {
      jobSequence: sequence,
      tripSequence: sequence,
      displayTitle: title,
      jobTripTemplate: JobTripTemplate.PICKUP_TO_DELIVERY,
      title,
      plannedStartAt: sequence === 1 ? pickupDate : null,
    };
  });
}

function contiguousDefaultTripSeeds(
  jobType: JobType,
  pickupDate: Date | null,
): DefaultTripSeed[] {
  const templates = CANONICAL_AUTO_TRIP_TEMPLATES[jobType];
  const titles = CANONICAL_AUTO_TRIP_TITLES[jobType];
  if (!templates?.length || !titles?.length) {
    return [
      {
        jobSequence: 1,
        tripSequence: 1,
        displayTitle: "Main leg",
        jobTripTemplate: JobTripTemplate.CUSTOM,
        title: "Main leg",
        plannedStartAt: pickupDate,
      },
    ];
  }
  return templates.map((jobTripTemplate, index) => {
    const title = titles[index] ?? jobTripTemplateDisplayLabel(jobTripTemplate);
    const sequence = index + 1;
    return {
      jobSequence: sequence,
      tripSequence: sequence,
      displayTitle: title,
      jobTripTemplate,
      title,
      // Job pickupDate is the first operational trip's service time.
      plannedStartAt: sequence === 1 ? pickupDate : null,
    };
  });
}

export function buildDefaultTripSeeds(
  jobType: JobType,
  pickupDate: Date | null,
  options?: Pick<TripCreateManyForJobOptions, "collectionContainerCount">,
): DefaultTripSeed[] {
  if (jobType === JobType.COLLECTION) {
    return buildCollectionTripSeeds(
      pickupDate,
      options?.collectionContainerCount ?? 0,
    );
  }
  return contiguousDefaultTripSeeds(jobType, pickupDate);
}

/**
 * IMPORT/EXPORT jobs are container-shipment oriented; auto-generated trips seed
 * container + shipping refs from job-level defaults when provided.
 * LCL is item-based: generated trips do not copy those fields (always null).
 * Patches and manual appends remain optional so legacy LCL rows are untouched.
 */
function tripCargoShippingSeedForJobType(
  jobType: JobType,
  containerNumber: string | null | undefined,
  shippingRefs: {
    carrier?: string | null;
    shipper?: string | null;
    vessel?: string | null;
  } | null | undefined,
): Pick<
  Prisma.TripCreateManyInput,
  "containerNumber" | "carrier" | "shipper" | "vessel"
> {
  if (jobType === JobType.LCL || jobType === JobType.COLLECTION) {
    return {
      containerNumber: null,
      carrier: null,
      shipper: null,
      vessel: null,
    };
  }

  return {
    containerNumber: String(containerNumber ?? "").trim() || null,
    carrier: String(shippingRefs?.carrier ?? "").trim() || null,
    shipper: String(shippingRefs?.shipper ?? "").trim() || null,
    vessel: String(shippingRefs?.vessel ?? "").trim() || null,
  };
}

export type JobAddressRouteInput = {
  pickupAddress1: string;
  pickupAddress2?: string | null;
  pickupPostal?: string | null;
  pickupPlaceId?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  deliveryAddress1: string;
  deliveryAddress2?: string | null;
  deliveryPostal?: string | null;
  deliveryPlaceId?: string | null;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
};

/** LCL PICKUP_TO_DELIVERY leg: job pickup/delivery addresses → trip origin/destination snapshots. */
export function lclPickupToDeliveryRouteSnapshot(
  input: JobAddressRouteInput,
): Partial<Prisma.TripCreateManyInput> {
  const pickupLabel = String(input.pickupAddress1 ?? "").trim() || null;
  const deliveryLabel = String(input.deliveryAddress1 ?? "").trim() || null;

  return {
    originLabel: pickupLabel,
    originAddressLine1: pickupLabel,
    originAddressLine2: String(input.pickupAddress2 ?? "").trim() || null,
    originPostalCode: String(input.pickupPostal ?? "").trim() || null,
    originCountry: "SG",
    originLat: input.pickupLat ?? null,
    originLng: input.pickupLng ?? null,
    originPlaceId: String(input.pickupPlaceId ?? "").trim() || null,
    destinationLabel: deliveryLabel,
    destinationAddressLine1: deliveryLabel,
    destinationAddressLine2: String(input.deliveryAddress2 ?? "").trim() || null,
    destinationPostalCode: String(input.deliveryPostal ?? "").trim() || null,
    destinationCountry: "SG",
    destinationLat: input.deliveryLat ?? null,
    destinationLng: input.deliveryLng ?? null,
    destinationPlaceId: String(input.deliveryPlaceId ?? "").trim() || null,
  };
}

/**
 * @deprecated Prefer canonicalAutoTripRouteSnapshots from job-route-locations.
 * Kept for existing unit tests that only seed the customer site on EXPORT legs 1–2.
 */
export function exportCustomerRouteSnapshots(
  input: JobAddressRouteInput,
): Partial<Record<JobTripTemplate, Partial<Prisma.TripCreateManyInput>>> {
  const customerLabel = String(input.deliveryAddress1 ?? "").trim() || null;
  const customerLine2 = String(input.deliveryAddress2 ?? "").trim() || null;
  const customerPostal = String(input.deliveryPostal ?? "").trim() || null;
  const customerPlaceId = String(input.deliveryPlaceId ?? "").trim() || null;
  return {
    [JobTripTemplate.DEPOT_TO_DELIVERY]: {
      destinationLabel: customerLabel,
      destinationAddressLine1: customerLabel,
      destinationAddressLine2: customerLine2,
      destinationPostalCode: customerPostal,
      destinationCountry: "SG",
      destinationLat: input.deliveryLat ?? null,
      destinationLng: input.deliveryLng ?? null,
      destinationPlaceId: customerPlaceId,
    },
    [JobTripTemplate.DELIVERY_TO_PORT]: {
      originLabel: customerLabel,
      originAddressLine1: customerLabel,
      originAddressLine2: customerLine2,
      originPostalCode: customerPostal,
      originCountry: "SG",
      originLat: input.deliveryLat ?? null,
      originLng: input.deliveryLng ?? null,
      originPlaceId: customerPlaceId,
    },
  };
}

/** Bulk-create default trips for a new job. Templates come only from `buildDefaultTripSeeds`. */
export function tripCreateManyForJob(
  tenantId: string,
  jobId: string,
  jobType: JobType,
  pickupDate: Date | null,
  containerNumber?: string | null,
  shippingRefs?: {
    carrier?: string | null;
    shipper?: string | null;
    vessel?: string | null;
  } | null,
  routeSnapshots?: Partial<
    Record<
      JobTripTemplate,
      Partial<Prisma.TripCreateManyInput>
    >
  >,
  options?: TripCreateManyForJobOptions,
): Prisma.TripCreateManyInput[] {
  const cargoShipping = tripCargoShippingSeedForJobType(
    jobType,
    containerNumber,
    shippingRefs,
  );
  return buildDefaultTripSeeds(jobType, pickupDate, {
    collectionContainerCount: options?.collectionContainerCount,
  }).map((s) => {
    const row: Prisma.TripCreateManyInput = {
      tenantId,
      jobId,
      jobSequence: s.jobSequence,
      tripSequence: s.tripSequence,
      displayTitle: s.displayTitle,
      jobTripTemplate: s.jobTripTemplate,
      title: s.title,
      plannedStartAt: s.plannedStartAt,
      status: TripStatus.DRAFT,
      pendingState: TripPendingState.NONE,
      tripPICName: null,
      tripPICContact: null,
      tripType: options?.tripType ?? undefined,
      ...cargoShipping,
      createdByUserId: options?.createdByUserId ?? null,
      completionRuleJson: completionRuleForTemplate(s.jobTripTemplate),
      ...(routeSnapshots?.[s.jobTripTemplate] ?? {}),
    };

    if (!canonicalAutoTripCarriesCreatedJobItems(jobType, s.jobTripTemplate)) {
      row.containerNumber = null;
    }

    // LCL/COLLECTION: never persist container/shipping defaults on bulk-generated legs.
    if (jobType === JobType.LCL || jobType === JobType.COLLECTION) {
      row.containerNumber = null;
      row.carrier = null;
      row.shipper = null;
      row.vessel = null;
    }

    return row;
  });
}

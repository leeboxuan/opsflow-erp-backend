import {
  JobTripTemplate,
  JobType,
  Prisma,
  TripDocumentType,
  TripPendingState,
  TripStatus,
} from "@prisma/client";
import { GUL_CIRCLE_LOCATION } from "../common/gul-circle-location";

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
  destinationAddressLine1: string | null;
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

/** Resolve route snapshot for append-trip, including map-ready Gul Circle defaults. */
export function resolveAppendTripRouteSnapshot(
  template: JobTripTemplate,
  dto: AppendTripRouteInput,
): ResolvedAppendTripRouteSnapshot {
  const g = GUL_CIRCLE_ROUTE_DEFAULTS;
  let originLabel = dto.originSummary?.trim() || null;
  let destinationLabel = dto.destinationSummary?.trim() || null;
  let originAddressLine1 = originLabel;
  let destinationAddressLine1 = destinationLabel;
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
    destinationAddressLine1,
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

/** Job types whose trip detail cargo is exposed as CONTAINER (not item/qty lines). */
export function isContainerCargoJobType(jobType: JobType): boolean {
  return (
    jobType === JobType.IMPORT
    || jobType === JobType.EXPORT
    || jobType === JobType.COLLECTION
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

export type BuildDefaultTripSeedsOptions = {
  /**
   * IMPORT only. When true (return location resolved on the job), adds a second
   * delivery → return leg. When false/omitted, IMPORT gets one port → delivery leg.
   */
  importHasReturnLocation?: boolean;
};

export type TripCreateManyForJobOptions = {
  createdByUserId?: string | null;
  tripSeedOptions?: BuildDefaultTripSeedsOptions;
};

/**
 * Default trip legs generated on job create.
 *
 * - LCL: 1 trip — pickup → delivery
 * - COLLECTION: 1 trip — pickup → delivery
 * - EXPORT: 1 trip — pickup → delivery/export location
 * - IMPORT without return location: 1 trip — port/terminal → delivery
 * - IMPORT with return location: 2 trips — port/terminal → delivery, then delivery → return
 */
export function buildDefaultTripSeeds(
  jobType: JobType,
  pickupDate: Date | null,
  options?: BuildDefaultTripSeedsOptions,
): DefaultTripSeed[] {
  const planned = pickupDate;

  if (jobType === JobType.LCL || jobType === JobType.COLLECTION) {
    return [
      {
        jobSequence: 1,
        tripSequence: 1,
        displayTitle: "Delivery",
        jobTripTemplate: JobTripTemplate.PICKUP_TO_DELIVERY,
        title: "Delivery",
        plannedStartAt: planned,
      },
    ];
  }

  if (jobType === JobType.IMPORT) {
    const legs: DefaultTripSeed[] = [
      {
        jobSequence: 1,
        tripSequence: 1,
        displayTitle: "Port to Delivery Point",
        jobTripTemplate: JobTripTemplate.PICKUP_TO_DELIVERY,
        title: "Port to Delivery Point",
        plannedStartAt: planned,
      },
    ];
    if (options?.importHasReturnLocation) {
      legs.push({
        jobSequence: 2,
        tripSequence: 2,
        displayTitle: "Delivery Point to Return",
        jobTripTemplate: JobTripTemplate.DELIVERY_TO_DEPOT,
        title: "Delivery Point to Return",
        plannedStartAt: planned,
      });
    }
    return legs;
  }

  if (jobType === JobType.EXPORT) {
    return [
      {
        jobSequence: 1,
        tripSequence: 1,
        displayTitle: "Pickup to Export Point",
        jobTripTemplate: JobTripTemplate.PICKUP_TO_DELIVERY,
        title: "Pickup to Export Point",
        plannedStartAt: planned,
      },
    ];
  }

  return [
    {
      jobSequence: 1,
      tripSequence: 1,
      displayTitle: "Main leg",
      jobTripTemplate: JobTripTemplate.CUSTOM,
      title: "Main leg",
      plannedStartAt: planned,
    },
  ];
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

/** Bulk-create default trips for a new job. Pass `options.tripSeedOptions.importHasReturnLocation` for IMPORT jobs with a return depot. */
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
  return buildDefaultTripSeeds(jobType, pickupDate, options?.tripSeedOptions).map((s) => {
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
      ...cargoShipping,
      createdByUserId: options?.createdByUserId ?? null,
      completionRuleJson: completionRuleForTemplate(s.jobTripTemplate),
      ...(routeSnapshots?.[s.jobTripTemplate] ?? {}),
    };

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

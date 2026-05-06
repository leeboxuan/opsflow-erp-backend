import {
  JobTripTemplate,
  JobType,
  Prisma,
  TripDocumentType,
  TripPendingState,
  TripStatus,
} from "@prisma/client";

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
  [JobTripTemplate.CUSTOM]: {
    requireGeneratedDoSigned: true,
    tripUploads: {
      minUploadCount: 1,
      allowedUploadTypes: [TripDocumentType.PICKUP_DO, TripDocumentType.POD_SIGNATURE],
    },
  },
};

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

export type DefaultTripSeed = {
  jobSequence: number;
  tripSequence: number;
  displayTitle: string;
  jobTripTemplate: JobTripTemplate;
  title: string;
  plannedStartAt: Date | null;
};

export function buildDefaultTripSeeds(
  jobType: JobType,
  pickupDate: Date | null,
): DefaultTripSeed[] {
  const planned = pickupDate;

  if (jobType === JobType.LCL) {
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
    return [
      {
        jobSequence: 1,
        tripSequence: 1,
        displayTitle: "Port to Delivery Point",
        jobTripTemplate: JobTripTemplate.PICKUP_TO_DELIVERY,
        title: "Port to Delivery Point",
        plannedStartAt: planned,
      },
      {
        jobSequence: 2,
        tripSequence: 2,
        displayTitle: "Delivery Point to Return",
        jobTripTemplate: JobTripTemplate.DELIVERY_TO_DEPOT,
        title: "Delivery Point to Return",
        plannedStartAt: planned,
      },
    ];
  }

  if (jobType === JobType.EXPORT) {
    return [
      {
        jobSequence: 1,
        tripSequence: 1,
        displayTitle: "Pickup Point to Port",
        jobTripTemplate: JobTripTemplate.DEPOT_TO_DELIVERY,
        title: "Pickup Point to Port",
        plannedStartAt: planned,
      },
      {
        jobSequence: 2,
        tripSequence: 2,
        displayTitle: "Return Leg",
        jobTripTemplate: JobTripTemplate.DELIVERY_TO_PORT,
        title: "Return Leg",
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
  if (jobType === JobType.LCL) {
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
  createdByUserId?: string | null,
): Prisma.TripCreateManyInput[] {
  const cargoShipping = tripCargoShippingSeedForJobType(
    jobType,
    containerNumber,
    shippingRefs,
  );
  return buildDefaultTripSeeds(jobType, pickupDate).map((s) => {
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
      createdByUserId: createdByUserId ?? null,
      completionRuleJson: completionRuleForTemplate(s.jobTripTemplate),
      ...(routeSnapshots?.[s.jobTripTemplate] ?? {}),
    };

    // LCL: never persist container/shipping defaults on bulk-generated legs.
    if (jobType === JobType.LCL) {
      row.containerNumber = null;
      row.carrier = null;
      row.shipper = null;
      row.vessel = null;
    }

    return row;
  });
}

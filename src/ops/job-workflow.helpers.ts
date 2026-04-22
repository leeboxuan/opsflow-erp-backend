import {
  JobTripTemplate,
  JobType,
  Prisma,
  TripDocumentType,
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
      minUploadCount: 1,
      allowedUploadTypes: [TripDocumentType.PICKUP_DO, TripDocumentType.OFFLOADING],
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
      allowedUploadTypes: [TripDocumentType.PICKUP_DO, TripDocumentType.OFFLOADING],
      requiredUploadTypesExact: [TripDocumentType.PICKUP_DO, TripDocumentType.OFFLOADING],
    },
  },
  [JobTripTemplate.DELIVERY_TO_PORT]: {
    requireGeneratedDoSigned: true,
    tripUploads: {
      minUploadCount: 1,
      allowedUploadTypes: [TripDocumentType.OFFLOADING],
      requiredUploadTypesExact: [TripDocumentType.OFFLOADING],
    },
  },
  [JobTripTemplate.CUSTOM]: {
    requireGeneratedDoSigned: true,
    tripUploads: {
      minUploadCount: 1,
      allowedUploadTypes: [TripDocumentType.PICKUP_DO, TripDocumentType.OFFLOADING],
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
        jobTripTemplate: JobTripTemplate.PICKUP_TO_DELIVERY,
        title: "Pickup to delivery",
        plannedStartAt: planned,
      },
    ];
  }

  if (jobType === JobType.IMPORT) {
    return [
      {
        jobSequence: 1,
        jobTripTemplate: JobTripTemplate.PICKUP_TO_DELIVERY,
        title: "Port pickup to delivery",
        plannedStartAt: planned,
      },
      {
        jobSequence: 2,
        jobTripTemplate: JobTripTemplate.DELIVERY_TO_DEPOT,
        title: "Delivery to return depot",
        plannedStartAt: planned,
      },
    ];
  }

  if (jobType === JobType.EXPORT) {
    return [
      {
        jobSequence: 1,
        jobTripTemplate: JobTripTemplate.DEPOT_TO_DELIVERY,
        title: "Container pickup to stuffing destination",
        plannedStartAt: planned,
      },
      {
        jobSequence: 2,
        jobTripTemplate: JobTripTemplate.DELIVERY_TO_PORT,
        title: "Stuffing destination to port",
        plannedStartAt: planned,
      },
    ];
  }

  return [
    {
      jobSequence: 1,
      jobTripTemplate: JobTripTemplate.CUSTOM,
      title: "Main leg",
      plannedStartAt: planned,
    },
  ];
}

export function tripCreateManyForJob(
  tenantId: string,
  jobId: string,
  jobType: JobType,
  pickupDate: Date | null,
  routeSnapshots?: Partial<
    Record<
      JobTripTemplate,
      Partial<Prisma.TripCreateManyInput>
    >
  >,
): Prisma.TripCreateManyInput[] {
  return buildDefaultTripSeeds(jobType, pickupDate).map((s) => ({
    tenantId,
    jobId,
    jobSequence: s.jobSequence,
    jobTripTemplate: s.jobTripTemplate,
    title: s.title,
    plannedStartAt: s.plannedStartAt,
    status: TripStatus.Draft,
    completionRuleJson: completionRuleForTemplate(s.jobTripTemplate),
    ...(routeSnapshots?.[s.jobTripTemplate] ?? {}),
  }));
}

import {
  JobTripTemplate,
  JobType,
  Prisma,
  TripDocumentType,
  TripStatus,
} from "@prisma/client";

export type TripCompletionRule = {
  requireGeneratedDoSigned: boolean;
  requiredTripUploadTypes: TripDocumentType[];
};

// Explicit, per-template completion rules.
// Extend by adding new JobTripTemplate keys here.
export const TRIP_COMPLETION_RULES: Record<JobTripTemplate, TripCompletionRule> = {
  [JobTripTemplate.PICKUP_TO_DELIVERY]: {
    requireGeneratedDoSigned: true,
    requiredTripUploadTypes: [TripDocumentType.OFFLOADING],
  },
  [JobTripTemplate.DELIVERY_TO_DEPOT]: {
    requireGeneratedDoSigned: true,
    requiredTripUploadTypes: [TripDocumentType.PICKUP_DO],
  },
  [JobTripTemplate.DEPOT_TO_DELIVERY]: {
    requireGeneratedDoSigned: true,
    requiredTripUploadTypes: [TripDocumentType.PICKUP_DO],
  },
  [JobTripTemplate.DELIVERY_TO_PORT]: {
    requireGeneratedDoSigned: true,
    requiredTripUploadTypes: [TripDocumentType.OFFLOADING],
  },
  [JobTripTemplate.CUSTOM]: {
    requireGeneratedDoSigned: true,
    requiredTripUploadTypes: [TripDocumentType.OFFLOADING],
  },
};

/** Default JSON rule checked by driver trip completion (see DriverJobsService). */
export function completionRuleForTemplate(
  template: JobTripTemplate,
): Prisma.InputJsonValue {
  const rule = TRIP_COMPLETION_RULES[template] ?? TRIP_COMPLETION_RULES[JobTripTemplate.CUSTOM];
  return {
    requireGeneratedDoSigned: rule.requireGeneratedDoSigned,
    requiredTripUploadTypes: [...rule.requiredTripUploadTypes],
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
        title: "Depot collection to delivery",
        plannedStartAt: planned,
      },
      {
        jobSequence: 2,
        jobTripTemplate: JobTripTemplate.DELIVERY_TO_PORT,
        title: "Delivery to port",
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
): Prisma.TripCreateManyInput[] {
  return buildDefaultTripSeeds(jobType, pickupDate).map((s) => ({
    tenantId,
    jobId,
    jobSequence: s.jobSequence,
    jobTripTemplate: s.jobTripTemplate,
    title: s.title,
    plannedStartAt: s.plannedStartAt,
    status: TripStatus.Planned,
    completionRuleJson: completionRuleForTemplate(s.jobTripTemplate),
  }));
}

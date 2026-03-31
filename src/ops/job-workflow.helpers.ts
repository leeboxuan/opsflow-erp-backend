import {
  JobTripTemplate,
  JobType,
  Prisma,
  TripStatus,
} from "@prisma/client";

/** Default JSON rule checked by driver trip completion (see DriverJobsService). */
export function completionRuleForTemplate(
  template: JobTripTemplate,
): Prisma.InputJsonValue {
  switch (template) {
    case JobTripTemplate.PICKUP_TO_DELIVERY:
      return {
        requireJobDoSigned: true,
        requiredTripUploadTypes: ["OFFLOADING"],
      };
    case JobTripTemplate.DELIVERY_TO_DEPOT:
      return {
        requireJobDoSigned: false,
        requiredTripUploadTypes: ["OFFLOADING"],
      };
    case JobTripTemplate.DEPOT_TO_DELIVERY:
      return {
        requireJobDoSigned: false,
        requiredTripUploadTypes: ["OFFLOADING"],
      };
    case JobTripTemplate.DELIVERY_TO_PORT:
      return {
        requireJobDoSigned: true,
        requiredTripUploadTypes: ["OFFLOADING", "POD_PHOTO"],
      };
    default:
      return {
        requireJobDoSigned: true,
        requiredTripUploadTypes: ["OFFLOADING"],
      };
  }
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

import {
  JobMovementScope,
  JobTripTemplate,
  JobType,
  TripPendingState,
} from "@prisma/client";
import {
  buildDefaultTripSeeds,
  jobItemIdsForCanonicalAutoTrip,
  tripCreateManyForJob,
} from "../workflows/job-workflow.helpers";
import {
  parentJobTypeForLegacyType,
  resolveMovementScopeForCreate,
} from "./job-movement-scope";

describe("canonical Job movement scopes", () => {
  it.each([
    [JobType.IMPORT, JobMovementScope.FULL_IMPORT, 3, 6],
    [JobType.IMPORT, JobMovementScope.IMPORT_DELIVERY_ONLY, 3, 3],
    [JobType.IMPORT, JobMovementScope.RETURN_ONLY, 3, 3],
    [JobType.EXPORT, JobMovementScope.FULL_EXPORT, 3, 6],
    [JobType.EXPORT, JobMovementScope.COLLECTION_ONLY, 3, 3],
    [JobType.EXPORT, JobMovementScope.EXPORT_DELIVERY_ONLY, 3, 3],
  ])(
    "%s / %s creates only its selected topology",
    (jobType, movementScope, containerCount, expectedTrips) => {
      const seeds = buildDefaultTripSeeds(jobType, null, {
        movementScope,
        importContainerCount: containerCount,
        exportContainerCount: containerCount,
      });
      expect(seeds).toHaveLength(expectedTrips);
    },
  );

  it("links both Full Export legs to the same canonical JobItem", () => {
    const ids = ["item-a", "item-b"];
    const linked = [1, 2, 3, 4].map((tripSequence) =>
      jobItemIdsForCanonicalAutoTrip({
        jobType: JobType.EXPORT,
        movementScope: JobMovementScope.FULL_EXPORT,
        jobTripTemplate:
          tripSequence % 2 === 1
            ? JobTripTemplate.DEPOT_TO_DELIVERY
            : JobTripTemplate.DELIVERY_TO_PORT,
        jobItemIds: ids,
        tripSequence,
      }),
    );
    expect(linked).toEqual([["item-a"], ["item-a"], ["item-b"], ["item-b"]]);
  });

  it("marks an unresolved return leg pending without scheduling any leg", () => {
    const rows = tripCreateManyForJob(
      "tenant",
      "job",
      JobType.IMPORT,
      new Date("2026-09-04T08:00:00.000Z"),
      null,
      null,
      {
        [JobTripTemplate.DELIVERY_TO_DEPOT]: {
          originAddressLine1: "Customer",
          destinationAddressLine1: null,
        },
      },
      {
        movementScope: JobMovementScope.RETURN_ONLY,
        importContainerCount: 1,
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].pendingState).toBe(TripPendingState.PENDING_AT_DEPOT);
    expect(rows[0].plannedStartAt).toBeNull();
  });

  it("maps legacy Collection and Return to parent categories", () => {
    expect(parentJobTypeForLegacyType(JobType.COLLECTION)).toBe(JobType.EXPORT);
    expect(parentJobTypeForLegacyType(JobType.RETURN)).toBe(JobType.IMPORT);
    expect(
      resolveMovementScopeForCreate({ jobType: JobType.COLLECTION }),
    ).toMatchObject({
      parentJobType: JobType.EXPORT,
      movementScope: JobMovementScope.COLLECTION_ONLY,
    });
  });
});

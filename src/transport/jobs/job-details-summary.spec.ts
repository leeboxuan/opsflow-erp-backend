import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { JobStatus, JobType, Role, TripStatus } from "@prisma/client";
import { TransportJobsService } from "./transport-jobs.service";
import {
  buildJobContainerSummary,
  buildJobPayoutSummary,
  effectivePayoutLineTotalCents,
  tripPayoutTotalCents,
} from "./job-details-summary";

describe("job details summaries", () => {
  it("uses positive totals, otherwise multiplies integer cents by quantity", () => {
    expect(
      effectivePayoutLineTotalCents({
        totalCents: 900,
        amountCents: 100,
        quantity: 2,
      }),
    ).toBe(900);
    expect(
      effectivePayoutLineTotalCents({
        totalCents: 0,
        amountCents: 125,
        quantity: 3,
      }),
    ).toBe(375);
    expect(
      effectivePayoutLineTotalCents({
        totalCents: null,
        amountCents: null,
        quantity: 2,
      }),
    ).toBe(0);
  });

  it("sums selectable lines and excludes cancelled trips from payout metrics", () => {
    const trips = [
      {
        id: "trip-1",
        status: TripStatus.COMPLETED,
        payoutLines: [
          { totalCents: 500, amountCents: 200, quantity: 2 },
          {
            totalCents: null,
            amountCents: 125,
            quantity: 2,
            isSelectableForTripEarning: true,
          },
          {
            totalCents: 999,
            isSelectableForTripEarning: false,
          },
        ],
      },
      { id: "trip-2", status: TripStatus.ONGOING, payoutLines: [] },
      {
        id: "trip-3",
        status: TripStatus.CANCELLED,
        payoutLines: [{ totalCents: 10000 }],
      },
    ];

    expect(tripPayoutTotalCents(trips[0].payoutLines)).toBe(750);
    expect(buildJobPayoutSummary(trips)).toEqual({
      currency: "SGD",
      totalCents: 750,
      totalTrips: 3,
      tripsWithPayout: 1,
      tripsWithoutPayout: 1,
    });
  });

  it("returns a valid empty payout result", () => {
    expect(buildJobPayoutSummary([])).toEqual({
      currency: "SGD",
      totalCents: 0,
      totalTrips: 0,
      tripsWithPayout: 0,
      tripsWithoutPayout: 0,
    });
  });

  it("returns a valid empty container result", () => {
    expect(buildJobContainerSummary([], [], new Map())).toEqual({
      totalContainers: 0,
      tripsWithContainers: 0,
      tripsWithoutContainers: 0,
      containers: [],
    });
  });

  it("preserves canonical links, duplicates, seals, and unlinked items", () => {
    const items = [
      { id: "item-1", itemCode: "DUP", sealNo: "SEAL-1" },
      { id: "item-2", itemCode: "DUP", sealNo: null },
      { id: "item-3", itemCode: "UNLINKED", sealNo: null },
    ];
    const trips = [
      {
        id: "trip-1",
        status: TripStatus.ONGOING,
        tripJobItems: [
          {
            id: "link-1",
            jobItemId: "item-1",
            containerNumberSnapshot: "DUP",
          },
          {
            id: "link-2",
            jobItemId: "item-2",
            containerNumberSnapshot: "DUP",
          },
        ],
      },
      {
        id: "trip-2",
        status: TripStatus.ONGOING,
        tripJobItems: [],
      },
      {
        id: "trip-cancelled",
        status: TripStatus.CANCELLED,
        tripJobItems: [],
      },
    ];

    const summary = buildJobContainerSummary(
      items,
      trips,
      new Map([["trip-1", "JOB-1-T01"]]),
    );

    expect(summary.totalContainers).toBe(3);
    expect(summary.tripsWithContainers).toBe(1);
    expect(summary.tripsWithoutContainers).toBe(1);
    expect(summary.containers).toHaveLength(3);
    expect(summary.containers.filter((item) => item.itemCode === "DUP")).toHaveLength(2);
    expect(summary.containers[1].sealNo).toBeNull();
    expect(summary.containers[2]).toMatchObject({
      id: "item-3",
      tripId: null,
      tripDisplayRef: null,
      trips: [],
    });
    expect(summary.containers[0].trips).toEqual([
      expect.objectContaining({ tripId: "trip-1", tripJobItemId: "link-1" }),
    ]);
  });

  it("emits one row per JobItem with stacked unique trips in sequence order", () => {
    const items = [
      { id: "item-a", itemCode: "OOCU9212980", sealNo: "S1", description: "A", qty: 1 },
      { id: "item-b", itemCode: "CSNU7730628", sealNo: "S2", description: "B", qty: 1 },
      { id: "item-c", itemCode: "FFAU2879099", sealNo: "S3", description: "C", qty: 1 },
    ];
    const trips = [
      {
        id: "trip-2",
        status: TripStatus.ONGOING,
        tripSequence: 2,
        tripJobItems: [
          { id: "link-a2", jobItemId: "item-a", containerNumberSnapshot: "OOCU9212980" },
          { id: "link-a2-dup", jobItemId: "item-a", containerNumberSnapshot: "OOCU9212980" },
        ],
      },
      {
        id: "trip-1",
        status: TripStatus.ONGOING,
        tripSequence: 1,
        tripJobItems: [
          { id: "link-a1", jobItemId: "item-a", containerNumberSnapshot: "OOCU9212980" },
        ],
      },
      {
        id: "trip-3",
        status: TripStatus.ONGOING,
        tripSequence: 3,
        tripJobItems: [
          { id: "link-b3", jobItemId: "item-b", containerNumberSnapshot: "CSNU7730628" },
        ],
      },
      {
        id: "trip-4",
        status: TripStatus.ONGOING,
        tripSequence: 4,
        tripJobItems: [
          { id: "link-b4", jobItemId: "item-b", containerNumberSnapshot: "CSNU7730628" },
        ],
      },
      {
        id: "trip-5",
        status: TripStatus.ONGOING,
        tripSequence: 5,
        tripJobItems: [
          { id: "link-c5", jobItemId: "item-c", containerNumberSnapshot: "FFAU2879099" },
        ],
      },
      {
        id: "trip-6",
        status: TripStatus.ONGOING,
        tripSequence: 6,
        tripJobItems: [
          { id: "link-c6", jobItemId: "item-c", containerNumberSnapshot: "FFAU2879099" },
        ],
      },
    ];

    const summary = buildJobContainerSummary(
      items,
      trips,
      new Map([
        ["trip-1", "JOB-1-T01"],
        ["trip-2", "JOB-1-T02"],
        ["trip-3", "JOB-1-T03"],
        ["trip-4", "JOB-1-T04"],
        ["trip-5", "JOB-1-T05"],
        ["trip-6", "JOB-1-T06"],
      ]),
    );

    expect(summary.containers).toHaveLength(3);
    expect(summary.containers.map((row) => row.itemCode)).toEqual([
      "OOCU9212980",
      "CSNU7730628",
      "FFAU2879099",
    ]);
    expect(summary.containers[0].qty).toBe(1);
    expect(summary.containers[0].trips.map((link) => link.tripDisplayRef)).toEqual([
      "JOB-1-T01",
      "JOB-1-T02",
    ]);
    expect(summary.containers.flatMap((row) => row.trips)).toHaveLength(6);
  });

  it("keeps distinct JobItems with a shared container number and null numbers separate", () => {
    const summary = buildJobContainerSummary(
      [
        { id: "item-1", itemCode: "SAME", qty: 2 },
        { id: "item-2", itemCode: "SAME", qty: 3 },
        { id: "item-3", itemCode: "", qty: 1 },
        { id: "item-4", itemCode: "", qty: 1 },
      ],
      [
        {
          id: "trip-1",
          status: TripStatus.ONGOING,
          tripSequence: 1,
          tripJobItems: [{ id: "l1", jobItemId: "item-1" }],
        },
      ],
      new Map([["trip-1", "JOB-1-T01"]]),
    );

    expect(summary.containers).toHaveLength(4);
    expect(summary.containers.map((row) => row.id)).toEqual([
      "item-1",
      "item-2",
      "item-3",
      "item-4",
    ]);
    expect(summary.containers[1].qty).toBe(3);
    expect(summary.containers[1].trips).toEqual([]);
  });
});

describe("TransportJobsService.getDetails", () => {
  const baseJob = {
    id: "job-1",
    tenantId: "tenant-1",
    customerCompanyId: "company-1",
    customerCompany: { id: "company-1", name: "ACME" },
    createdBy: { id: "creator-1", name: "Creator", email: "creator@example.com" },
    assignedDriver: null,
    internalRef: "JOB-1",
    externalRef: null,
    jobType: JobType.IMPORT,
    collectionType: null,
    status: JobStatus.ONGOING,
    pickupDate: null,
    pickupAddress1: "Pickup",
    pickupAddress2: null,
    pickupPostal: null,
    pickupContactName: null,
    pickupContactPhone: null,
    deliveryAddress1: "Delivery",
    deliveryAddress2: null,
    deliveryPostal: null,
    receiverName: "Receiver",
    receiverPhone: "123",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    items: [
      {
        id: "item-1",
        tenantId: "tenant-1",
        jobId: "job-1",
        itemCode: "CONT-1",
        sealNo: "SEAL-1",
        description: null,
        pickupReference: null,
        qty: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    trips: [
      {
        id: "trip-1",
        tenantId: "tenant-1",
        jobId: "job-1",
        status: TripStatus.ONGOING,
        tripSequence: 1,
        jobSequence: 1,
        displayTitle: "Delivery",
        title: "Delivery",
        assignedDriverUserId: null,
        plannedStartAt: null,
        startedAt: null,
        closedAt: null,
        payoutLines: [
          {
            id: "line-1",
            sourceType: "DRIVER_RATE_MASTER",
            payoutItemId: null,
            earningRateMasterId: null,
            code: "TRIP",
            label: "Trip payout",
            description: null,
            unit: "trip",
            quantity: 2,
            amountCents: 500,
            totalCents: 1000,
            isManual: false,
            requiresManualAmount: false,
            isSelectableForTripEarning: true,
            sortOrder: 1,
          },
        ],
        tripJobItems: [
          {
            id: "link-1",
            jobItemId: "item-1",
            containerNumberSnapshot: "CONT-1",
          },
        ],
        documents: [],
        documentRequirements: [],
        vehicles: null,
        fleetVehicle: null,
        _count: { stops: 2, tripJobItems: 1 },
      },
    ],
    charges: [],
    documents: [],
  };

  function makeService(jobResult: any) {
    const prisma: any = {
      job: { findFirst: jest.fn().mockResolvedValue(jobResult) },
    };
    return {
      prisma,
      service: new TransportJobsService(
        prisma,
        { log: jest.fn() } as any,
        { getClient: jest.fn() } as any,
      ),
    };
  }

  it("uses one tenant-scoped job graph and returns canonical summaries", async () => {
    const { service, prisma } = makeService(baseJob);
    const result = await service.getDetails("tenant-1", "job-1", {
      role: Role.TRANSPORT_STAFF,
    });

    expect(prisma.job.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.job.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1", tenantId: "tenant-1" },
        include: expect.objectContaining({
          items: expect.any(Object),
          trips: expect.objectContaining({
            include: expect.objectContaining({
              payoutLines: expect.any(Object),
              tripJobItems: expect.any(Object),
              documents: expect.any(Object),
            }),
          }),
        }),
      }),
    );
    expect(result.payoutSummary.totalCents).toBe(1000);
    expect(result.containerSummary.containers[0]).toMatchObject({
      id: "item-1",
      tripId: "trip-1",
      sealNo: "SEAL-1",
      trips: [
        expect.objectContaining({
          tripId: "trip-1",
          tripDisplayRef: "JOB-1-T01",
        }),
      ],
    });
    expect(result.trips[0]).toMatchObject({
      payoutTotalCents: 1000,
      stopCount: 2,
      containerCount: 1,
      cargoLabels: ["CONT-1"],
      tripDisplayRef: "JOB-1-T01",
    });
    expect(result.trips[0].id).toBe("trip-1");
    expect(result.trips[0].fromLabel).toBeTruthy();
    expect(result.trips[0].toLabel).toBeTruthy();
  });

  it("returns the standard 404 for missing or cross-tenant jobs", async () => {
    const { service } = makeService(null);
    await expect(
      service.getDetails("tenant-1", "foreign-job", {
        role: Role.TRANSPORT_STAFF,
      }),
    ).rejects.toEqual(new NotFoundException("Job not found"));
  });

  it("preserves customer-company access checks", async () => {
    const { service } = makeService(baseJob);
    await expect(
      service.getDetails("tenant-1", "job-1", {
        role: Role.CUSTOMER,
        customerCompanyId: "company-2",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

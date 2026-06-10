import { JobStatus, JobType, Role, TripDocumentType, TripStatus } from "@prisma/client";
import { OpsJobsService } from "./ops-jobs.service";

function makeService(overrides?: {
  tripDocuments?: any[];
  trips?: any[];
}) {
  const tripDocuments = overrides?.tripDocuments ?? [];
  const trips = overrides?.trips ?? [
    {
      id: "trip-auto",
      jobId: "job1",
      tenantId: "t1",
      status: TripStatus.PUBLISHED,
      jobSequence: 1,
      tripSequence: 1,
      completionRuleJson: null,
    },
    {
      id: "trip-added",
      jobId: "job1",
      tenantId: "t1",
      status: TripStatus.PUBLISHED,
      jobSequence: 2,
      tripSequence: 2,
      completionRuleJson: null,
    },
  ];

  const prisma: any = {
    job: {
      findFirst: jest.fn().mockResolvedValue({
        id: "job1",
        tenantId: "t1",
        jobType: JobType.LCL,
        status: JobStatus.ONGOING,
        customerCompanyId: "cc1",
        internalRef: "JOB-1",
        receiverName: "Receiver",
        receiverPhone: "90000000",
        customerCompany: { id: "cc1", name: "ACME" },
        assignedDriver: null,
        createdBy: null,
        items: [{ id: "item1", itemCode: "A", qty: 1 }],
        trips,
        charges: [],
        documents: [],
      }),
    },
    trip: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        const trip = trips.find(
          (t) =>
            t.id === where.id
            && t.jobId === where.jobId
            && t.tenantId === where.tenantId,
        );
        return Promise.resolve(trip ?? null);
      }),
    },
    tripDocument: {
      findMany: jest.fn().mockImplementation(({ where }: any) => {
        if (where.tripId?.in) {
          return Promise.resolve(
            tripDocuments.filter(
              (d) =>
                d.tenantId === where.tenantId
                && d.isActive === true
                && where.tripId.in.includes(d.tripId),
            ),
          );
        }
        if (where.tripId) {
          return Promise.resolve(
            tripDocuments.filter(
              (d) =>
                d.tenantId === where.tenantId
                && d.isActive === true
                && d.tripId === where.tripId,
            ),
          );
        }
        return Promise.resolve([]);
      }),
    },
    vehicle: { findFirst: jest.fn().mockResolvedValue(null) },
    fleetVehicle: { findFirst: jest.fn().mockResolvedValue(null) },
  };

  const svc = new OpsJobsService(
    prisma,
    { log: jest.fn() } as any,
    { getClient: jest.fn() } as any,
  );
  jest.spyOn(svc as any, "buildUserNameMapByIds").mockResolvedValue(new Map());
  jest.spyOn(svc as any, "attachTripAssignedDriverNamesForJobs").mockResolvedValue(undefined);

  return { svc, prisma };
}

describe("OpsJobsService admin trip documents", () => {
  const user = { userId: "ops-1", role: Role.OPS };
  const trailerStartDoc = {
    id: "doc-trailer-start",
    tenantId: "t1",
    tripId: "trip-added",
    type: TripDocumentType.TRAILER_START_PHOTO,
    storageKey: "t1/jobs/job1/trips/trip-added/trailer_start_photo/start.jpg",
    originalName: "start.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100,
    isActive: true,
    createdAt: new Date("2026-06-10T08:00:00.000Z"),
    uploadedByUserId: "driver-1",
    uploadedBy: null,
    generatedBySystem: false,
    isSigned: false,
  };

  it("listTripDocuments returns TRAILER_START_PHOTO for appended trip", async () => {
    const { svc } = makeService({ tripDocuments: [trailerStartDoc] });

    const docs = await svc.listTripDocuments(
      "t1",
      "job1",
      "trip-added",
      user,
    );

    expect(docs).toHaveLength(1);
    expect(docs[0].type).toBe(TripDocumentType.TRAILER_START_PHOTO);
    expect(docs[0].tripId).toBe("trip-added");
  });

  it("getOne attaches trip documents grouped by tripId", async () => {
    const deliveryDoDoc = {
      id: "doc-delivery",
      tenantId: "t1",
      tripId: "trip-auto",
      type: TripDocumentType.DELIVERY_DO,
      storageKey: "t1/jobs/job1/trips/trip-auto/delivery-do/do.pdf",
      originalName: "do.pdf",
      mimeType: "application/pdf",
      sizeBytes: 200,
      isActive: true,
      createdAt: new Date("2026-06-10T07:00:00.000Z"),
      uploadedByUserId: null,
      uploadedBy: null,
      generatedBySystem: true,
      isSigned: false,
    };
    const { svc } = makeService({
      tripDocuments: [trailerStartDoc, deliveryDoDoc],
    });

    const job = await svc.getOne("t1", "job1", user);
    const addedTrip = job.trips?.find((t) => t.id === "trip-added");
    const autoTrip = job.trips?.find((t) => t.id === "trip-auto");

    expect(addedTrip?.documents).toHaveLength(1);
    expect(addedTrip?.documents?.[0].type).toBe(
      TripDocumentType.TRAILER_START_PHOTO,
    );
    expect(addedTrip?.documentStatus?.trailerStartPhoto).toBe("UPLOADED");
    expect(autoTrip?.documents).toHaveLength(1);
    expect(autoTrip?.documents?.[0].type).toBe(TripDocumentType.DELIVERY_DO);
  });

  it("does not return documents from another tenant", async () => {
    const foreignDoc = {
      ...trailerStartDoc,
      id: "foreign",
      tenantId: "other-tenant",
    };
    const { svc } = makeService({ tripDocuments: [foreignDoc] });

    const docs = await svc.listTripDocuments(
      "t1",
      "job1",
      "trip-added",
      user,
    );

    expect(docs).toHaveLength(0);
  });
});

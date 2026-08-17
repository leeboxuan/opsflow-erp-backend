import { JobStatus, JobType, Role, TripStatus } from "@prisma/client";
import { TransportJobsService } from "./transport-jobs.service";

describe("TransportJobsService.list (slim)", () => {
  it("returns list rows without full trips/items/documents", async () => {
    const prisma: any = {
      $transaction: jest.fn((ops: any[]) => Promise.all(ops.map((fn) => fn))),
      job: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "job1",
            tenantId: "t1",
            customerCompanyId: "c1",
            internalRef: "WF-2026-05-0001-LCL",
            externalRef: "EXT-1",
            jobType: JobType.LCL,
            status: JobStatus.ONGOING,
            pickupDate: new Date("2026-05-21"),
            createdAt: new Date("2026-05-20"),
            updatedAt: new Date("2026-05-21"),
            customerCompany: { name: "ACME" },
            _count: { items: 3, trips: 2, documents: 1 },
            trips: [{ assignedDriverUserId: "driver-1" }],
          },
        ]),
      },
      trip: {
        findMany: jest.fn().mockResolvedValue([
          { jobId: "job1", status: TripStatus.COMPLETED },
          { jobId: "job1", status: TripStatus.PUBLISHED },
        ]),
      },
      invoice: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([
          { userId: "driver-1", user: { name: "Driver One", email: "d@example.com" } },
        ]),
      },
    };

    const svc = new TransportJobsService(prisma, { log: jest.fn() } as any, {} as any);
    const res = await svc.list("t1", {} as any, { role: Role.TRANSPORT_STAFF, customerCompanyId: null });

    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toEqual(
      expect.objectContaining({
        id: "job1",
        companyName: "ACME",
        tripCount: 2,
        itemCount: 3,
        documentCount: 1,
        assignedDriverId: "driver-1",
        assignedDriverName: "Driver One",
        tripProgress: { completed: 1, total: 2, isComplete: false },
        invoice: null,
      }),
    );
    expect(res.data[0]).not.toHaveProperty("trips");
    expect(res.data[0]).not.toHaveProperty("items");
    expect(res.data[0]).not.toHaveProperty("charges");

    const findManyArg = prisma.job.findMany.mock.calls[0][0];
    expect(findManyArg.select).toBeDefined();
    expect(findManyArg.include).toBeUndefined();
    expect(findManyArg.select.trips.take).toBe(1);
  });
});

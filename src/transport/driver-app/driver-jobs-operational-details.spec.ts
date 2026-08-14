import { TripStatus } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";

describe("DriverJobsService updateOperationalDetails", () => {
  const tenantId = "t1";
  const jobId = "job1";
  const tripId = "trip1";
  const driverUserId = "driver-1";

  function makeSvc(opts?: { tripStatus?: TripStatus; containerNumber?: string | null }) {
    const jobItemUpdate = jest.fn();
    const tripUpdate = jest.fn();
    const auditLog = jest.fn();
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({ id: jobId, status: "ONGOING" }),
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: tripId,
          tenantId,
          jobId,
          status: opts?.tripStatus ?? TripStatus.ONGOING,
          assignedDriverUserId: driverUserId,
          containerNumber: opts?.containerNumber ?? "CONT-OLD",
          driverRemarks: null,
        }),
      },
      jobItem: {
        findMany: jest.fn().mockResolvedValue([
          { id: "item-1", itemCode: "CONT-OLD", sealNo: "SEAL-OLD" },
        ]),
        update: jobItemUpdate,
      },
      $transaction: jest.fn(async (cb: any) =>
        cb({
          jobItem: { update: jobItemUpdate },
          trip: { update: tripUpdate },
        }),
      ),
      masterTrailerLocation: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    // getTripDetailForDriver after update
    prisma.trip.findFirst
      .mockResolvedValueOnce({
        id: tripId,
        tenantId,
        jobId,
        status: opts?.tripStatus ?? TripStatus.ONGOING,
        assignedDriverUserId: driverUserId,
        containerNumber: opts?.containerNumber ?? "CONT-OLD",
        driverRemarks: null,
      })
      .mockResolvedValue({
        id: tripId,
        tenantId,
        jobId,
        status: opts?.tripStatus ?? TripStatus.ONGOING,
        assignedDriverUserId: driverUserId,
        containerNumber: "CONT-NEW",
        driverRemarks: "Late at gate",
        documents: [],
        job: {
          id: jobId,
          internalRef: "REF",
          jobType: "IMPORT",
          description: "Ops description",
          pickupReference: "PU",
          items: [
            { id: "item-1", itemCode: "CONT-NEW", sealNo: "SEAL-NEW", qty: null },
          ],
        },
      });

    const svc = new DriverJobsService(
      prisma,
      { log: auditLog } as any,
      { getClient: jest.fn() } as any,
    );

    return { svc, prisma, jobItemUpdate, tripUpdate, auditLog };
  }

  it("updates container/seal by itemId and driver remarks", async () => {
    const { svc, jobItemUpdate, tripUpdate, auditLog } = makeSvc();

    const result = await svc.updateOperationalDetails(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      {
        containers: [
          {
            itemId: "item-1",
            containerNumber: "CONT-NEW",
            sealNumber: "SEAL-NEW",
          },
        ],
        driverRemarks: "Late at gate",
      },
    );

    expect(jobItemUpdate).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { itemCode: "CONT-NEW", sealNo: "SEAL-NEW" },
    });
    expect(tripUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ containerNumber: "CONT-NEW" }),
      }),
    );
    expect(tripUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ driverRemarks: "Late at gate" }),
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      tenantId,
      "TRIP_OPERATIONAL_DETAILS_UPDATE",
      "TRIP",
      tripId,
      expect.objectContaining({
        changedFields: expect.arrayContaining([
          "containerNumber",
          "sealNumber",
          "driverRemarks",
        ]),
      }),
      driverUserId,
    );
    expect(result.driverRemarks).toBe("Late at gate");
    expect(result.job.description).toBe("Ops description");
  });

  it("rejects foreign itemIds", async () => {
    const { svc, prisma } = makeSvc();
    prisma.jobItem.findMany.mockResolvedValue([]);

    await expect(
      svc.updateOperationalDetails(tenantId, jobId, tripId, driverUserId, {
        containers: [{ itemId: "foreign", containerNumber: "X" }],
      }),
    ).rejects.toThrow(/do not belong to this job/);
  });

  it("updates only the addressed JobItem and leaves others untouched", async () => {
    const { svc, prisma, jobItemUpdate } = makeSvc();
    const allItems = [
      { id: "item-1", itemCode: "CONT-OLD", sealNo: "SEAL-OLD" },
      { id: "item-2", itemCode: "CONT-B", sealNo: "SEAL-B" },
    ];
    prisma.jobItem.findMany.mockImplementation(async ({ where }: any) => {
      const ids: string[] = where?.id?.in ?? [];
      return allItems.filter((item) => ids.includes(item.id));
    });

    await svc.updateOperationalDetails(tenantId, jobId, tripId, driverUserId, {
      containers: [{ itemId: "item-1", containerNumber: "CONT-NEW", sealNumber: "SEAL-NEW" }],
    });

    expect(jobItemUpdate).toHaveBeenCalledTimes(1);
    expect(jobItemUpdate).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { itemCode: "CONT-NEW", sealNo: "SEAL-NEW" },
    });
  });

  it("rejects edits after completion", async () => {
    const { svc } = makeSvc({ tripStatus: TripStatus.COMPLETED });

    await expect(
      svc.updateOperationalDetails(tenantId, jobId, tripId, driverUserId, {
        driverRemarks: "too late",
      }),
    ).rejects.toThrow(/PUBLISHED or ONGOING/);
  });
});

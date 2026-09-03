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
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
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
        previousDriverRemarks: null,
        driverRemarks: "Late at gate",
        actorUserId: driverUserId,
      }),
      driverUserId,
    );
    expect(result.driverRemarks).toBe("Late at gate");
    expect(result.job.description).toBe("Ops description");
  });

  it("preserves previous remarks in audit history on edit", async () => {
    const { svc, auditLog, prisma } = makeSvc();
    prisma.trip.findFirst.mockReset();
    prisma.trip.findFirst
      .mockResolvedValueOnce({
        id: tripId,
        tenantId,
        jobId,
        status: TripStatus.ONGOING,
        assignedDriverUserId: driverUserId,
        containerNumber: "CONT-OLD",
        driverRemarks: "Late at gate",
      })
      .mockResolvedValue({
        id: tripId,
        tenantId,
        jobId,
        status: TripStatus.ONGOING,
        assignedDriverUserId: driverUserId,
        containerNumber: "CONT-OLD",
        driverRemarks: "Cleared customs",
        documents: [],
        job: {
          id: jobId,
          internalRef: "REF",
          jobType: "IMPORT",
          description: "Ops description",
          pickupReference: "PU",
          items: [],
        },
      });

    await svc.updateOperationalDetails(tenantId, jobId, tripId, driverUserId, {
      driverRemarks: "Cleared customs",
    });

    expect(auditLog).toHaveBeenCalledWith(
      tenantId,
      "TRIP_OPERATIONAL_DETAILS_UPDATE",
      "TRIP",
      tripId,
      expect.objectContaining({
        previousDriverRemarks: "Late at gate",
        driverRemarks: "Cleared customs",
        changedFields: ["driverRemarks"],
      }),
      driverUserId,
    );
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

  it("updates an anonymous (null itemCode) linked JobItem without inventing identity until driver supplies it", async () => {
    const { svc, prisma, jobItemUpdate } = makeSvc({ containerNumber: null });
    prisma.jobItem.findMany.mockResolvedValue([
      { id: "item-anon", itemCode: null, sealNo: null, containerSize: null },
    ]);

    await svc.updateOperationalDetails(tenantId, jobId, tripId, driverUserId, {
      containers: [
        { itemId: "item-anon", containerNumber: "TCLU9999999", sealNumber: "SEAL-9" },
      ],
    });

    expect(jobItemUpdate).toHaveBeenCalledWith({
      where: { id: "item-anon" },
      data: { itemCode: "TCLU9999999", sealNo: "SEAL-9" },
    });
  });

  it("does not require or write containerSize when driver PATCHes number/seal (legacy null preserved)", async () => {
    const { svc, prisma, jobItemUpdate } = makeSvc();
    prisma.jobItem.findMany.mockResolvedValue([
      { id: "item-1", itemCode: "CONT-OLD", sealNo: "SEAL-OLD", containerSize: null },
    ]);

    await svc.updateOperationalDetails(tenantId, jobId, tripId, driverUserId, {
      containers: [
        { itemId: "item-1", containerNumber: "CONT-NEW", sealNumber: "SEAL-NEW" },
      ],
    });

    expect(prisma.jobItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, jobId, id: { in: ["item-1"] } },
      }),
    );
    expect(jobItemUpdate).toHaveBeenCalledTimes(1);
    const updateArg = jobItemUpdate.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "item-1" });
    expect(updateArg.data).toEqual({ itemCode: "CONT-NEW", sealNo: "SEAL-NEW" });
    expect(updateArg.data).not.toHaveProperty("containerSize");
  });

  it("preserves an existing non-null containerSize when omitted from driver PATCH", async () => {
    const { svc, prisma, jobItemUpdate } = makeSvc();
    prisma.jobItem.findMany.mockResolvedValue([
      {
        id: "item-1",
        itemCode: "CONT-OLD",
        sealNo: "SEAL-OLD",
        containerSize: "FT_40",
      },
    ]);

    await svc.updateOperationalDetails(tenantId, jobId, tripId, driverUserId, {
      containers: [{ itemId: "item-1", containerNumber: "CONT-NEW" }],
    });

    const updateArg = jobItemUpdate.mock.calls[0][0];
    expect(updateArg.data).toEqual({ itemCode: "CONT-NEW" });
    expect(updateArg.data).not.toHaveProperty("containerSize");
  });

  it("rejects itemIds that belong to another tenant or job", async () => {
    const { svc, prisma } = makeSvc();
    prisma.jobItem.findMany.mockResolvedValue([]);

    await expect(
      svc.updateOperationalDetails(tenantId, jobId, tripId, driverUserId, {
        containers: [
          { itemId: "other-tenant-item", containerNumber: "HACK" },
        ],
      }),
    ).rejects.toThrow(/do not belong to this job/);

    expect(prisma.jobItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId,
          jobId,
          id: { in: ["other-tenant-item"] },
        },
      }),
    );
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

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";
import { OpsJobsService } from "./ops-jobs.service";

describe("OpsJobsService.deleteTrip", () => {
  function makeService(prismaOverrides?: Record<string, any>) {
    const prisma: any = {
      trip: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      job: {
        findFirst: jest.fn().mockResolvedValue({ id: "job1", status: "ONGOING" }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      ...prismaOverrides,
    };
    const svc = new OpsJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
    );
    return { svc, prisma };
  }

  const baseTrip = {
    id: "trip1",
    status: TripStatus.DRAFT,
    jobSequence: 1,
    tripSequence: 1,
    assignedDriverUserId: null,
    startedAt: null,
    closedAt: null,
    documents: [],
    payoutLines: [],
  };

  it("DRAFT trip can be hard deleted and resequences remaining trips", async () => {
    const { svc, prisma } = makeService();
    prisma.trip.findFirst.mockResolvedValue(baseTrip);
    prisma.trip.findMany.mockResolvedValue([{ id: "trip2" }, { id: "trip3" }]);

    const res = await svc.deleteTrip("t1", "job1", "trip1", { userId: "u1", role: "OPS" });

    expect(prisma.trip.delete).toHaveBeenCalledWith({ where: { id: "trip1" } });
    expect(prisma.trip.update).toHaveBeenNthCalledWith(1, {
      where: { id: "trip2" },
      data: { tripSequence: 1, jobSequence: 1 },
    });
    expect(prisma.trip.update).toHaveBeenNthCalledWith(2, {
      where: { id: "trip3" },
      data: { tripSequence: 2, jobSequence: 2 },
    });
    expect(res).toEqual({ success: true, mode: "deleted", tripId: "trip1" });
  });

  it("PUBLISHED trip becomes CANCELLED", async () => {
    const { svc, prisma } = makeService();
    prisma.trip.findFirst.mockResolvedValue({ ...baseTrip, status: TripStatus.PUBLISHED });
    const res = await svc.deleteTrip("t1", "job1", "trip1", { userId: "u1", role: "OPS" });
    expect(prisma.trip.update).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: { status: TripStatus.CANCELLED, updatedByUserId: "u1" },
    });
    expect(res.mode).toBe("cancelled");
    expect(res.status).toBe(TripStatus.CANCELLED);
  });

  it("ONGOING trip becomes CANCELLED", async () => {
    const { svc, prisma } = makeService();
    prisma.trip.findFirst.mockResolvedValue({ ...baseTrip, status: TripStatus.ONGOING });
    const res = await svc.deleteTrip("t1", "job1", "trip1", { userId: "u1", role: "OPS" });
    expect(prisma.trip.update).toHaveBeenCalled();
    expect(res.mode).toBe("cancelled");
  });

  it("CANCELLED trip returns stable cancelled success without extra update", async () => {
    const { svc, prisma } = makeService();
    prisma.trip.findFirst.mockResolvedValue({ ...baseTrip, status: TripStatus.CANCELLED });
    const res = await svc.deleteTrip("t1", "job1", "trip1", { userId: "u1", role: "OPS" });
    expect(prisma.trip.update).not.toHaveBeenCalled();
    expect(res).toEqual({
      success: true,
      mode: "cancelled",
      tripId: "trip1",
      status: TripStatus.CANCELLED,
    });
  });

  it("COMPLETED trip cannot be deleted", async () => {
    const { svc, prisma } = makeService();
    prisma.trip.findFirst.mockResolvedValue({ ...baseTrip, status: TripStatus.COMPLETED });
    await expect(
      svc.deleteTrip("t1", "job1", "trip1", { userId: "u1", role: "OPS" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("DONE trip cannot be deleted", async () => {
    const { svc, prisma } = makeService();
    prisma.trip.findFirst.mockResolvedValue({ ...baseTrip, status: TripStatus.DONE });
    await expect(
      svc.deleteTrip("t1", "job1", "trip1", { userId: "u1", role: "OPS" }),
    ).rejects.toThrow("COMPLETED or DONE");
  });

  it("wrong tenant/job/trip returns not found", async () => {
    const { svc, prisma } = makeService();
    prisma.trip.findFirst.mockResolvedValue(null);
    await expect(
      svc.deleteTrip("t1", "job1", "missing", { userId: "u1", role: "OPS" }),
    ).rejects.toThrow(NotFoundException);
  });

  it("deleting one trip does not delete the job", async () => {
    const { svc, prisma } = makeService({
      job: {
        findFirst: jest.fn().mockResolvedValue({ id: "job1", status: "ONGOING" }),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
    });
    prisma.trip.findFirst.mockResolvedValue(baseTrip);
    await svc.deleteTrip("t1", "job1", "trip1", { userId: "u1", role: "OPS" });
    expect(prisma.job.delete).not.toHaveBeenCalled();
  });

  it("draft trip with operational records is soft-cancelled instead of hard deleted", async () => {
    const { svc, prisma } = makeService();
    prisma.trip.findFirst.mockResolvedValue({
      ...baseTrip,
      status: TripStatus.DRAFT,
      documents: [{ id: "d1" }],
    });
    const res = await svc.deleteTrip("t1", "job1", "trip1", { userId: "u1", role: "OPS" });
    expect(prisma.trip.delete).not.toHaveBeenCalled();
    expect(prisma.trip.update).toHaveBeenCalled();
    expect(res.mode).toBe("cancelled");
  });

  it("cancelling last incomplete trip makes job READY_FOR_INVOICE when remaining trips are completed/done", async () => {
    const { svc, prisma } = makeService();
    prisma.trip.findFirst.mockResolvedValue({ ...baseTrip, status: TripStatus.PUBLISHED });
    prisma.trip.findMany.mockResolvedValue([
      { status: TripStatus.COMPLETED },
      { status: TripStatus.DONE },
      { status: TripStatus.CANCELLED },
    ]);

    await svc.deleteTrip("t1", "job1", "trip1", { userId: "u1", role: "OPS" });

    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: "job1" },
      data: {
        status: "READY_FOR_INVOICE",
        invoiceReadyAt: expect.any(Date),
      },
    });
  });
});

import { DriverJobsService } from "./driver-jobs.service";

describe("DriverJobsService listChassisOptionsForDriver", () => {
  it("returns tenant-scoped ACTIVE options and disables foreign checkouts", async () => {
    const prisma: any = {
      chassis: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "c1",
            tenantId: "t1",
            chassisNo: "TR1",
            label: null,
            status: "ACTIVE",
            isBorrowed: false,
            borrowedFromCompany: null,
          },
          {
            id: "c2",
            tenantId: "t1",
            chassisNo: "TR2",
            label: null,
            status: "ACTIVE",
            isBorrowed: true,
            borrowedFromCompany: "Acme",
          },
        ]),
      },
      trip: {
        findMany: jest.fn().mockResolvedValue([{ id: "other-trip", chassisId: "c2" }]),
      },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };

    const svc = new DriverJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const res = await svc.listChassisOptionsForDriver("t1", {
      q: "acme",
      forTripId: "trip-1",
      page: 1,
      pageSize: 50,
    });

    expect(prisma.chassis.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t1",
          status: "ACTIVE",
        }),
      }),
    );
    expect(res.data[0].selectable).toBe(true);
    expect(res.data[1]).toMatchObject({
      id: "c2",
      selectable: false,
      availability: "CHECKED_OUT",
      ownershipLabel: "Borrowed · Acme",
    });
  });

  it("keeps currently selected trip chassis selectable", async () => {
    const prisma: any = {
      chassis: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "c1",
            tenantId: "t1",
            chassisNo: "TR1",
            label: null,
            status: "ACTIVE",
            isBorrowed: false,
            borrowedFromCompany: null,
          },
        ]),
      },
      trip: {
        findMany: jest.fn().mockResolvedValue([{ id: "trip-1", chassisId: "c1" }]),
      },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };

    const svc = new DriverJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const res = await svc.listChassisOptionsForDriver("t1", { forTripId: "trip-1" });
    expect(res.data[0]).toMatchObject({
      selectable: true,
      availability: "CHECKED_OUT",
      currentTripId: "trip-1",
    });
  });
});

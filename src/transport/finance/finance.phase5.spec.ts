import { FinanceService } from "./finance.service";

describe("FinanceService Phase 5 wallet batching", () => {
  it("summarizes wallets via groupBy without loading full transaction rows", async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { driverId: "d1", _sum: { amountCents: 1500 } },
      { driverId: "d2", _sum: { amountCents: -200 } },
    ]);
    const findManyDrivers = jest.fn().mockResolvedValue([
      { id: "d1", name: "Driver One" },
      { id: "d2", name: "Driver Two" },
    ]);
    const findManyTx = jest.fn();
    const prisma: any = {
      driverWalletTransaction: {
        groupBy,
        findMany: findManyTx,
      },
      drivers: { findMany: findManyDrivers },
    };
    const svc = new FinanceService(prisma);

    const rows = await svc.getDriverWalletSummaries("tenant-a", "2026-05");
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(findManyTx).not.toHaveBeenCalled();
    expect(findManyDrivers).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", id: { in: ["d1", "d2"] } },
      select: { id: true, name: true },
    });
    expect(rows).toEqual([
      { driverId: "d1", driverName: "Driver One", totalCents: 1500 },
      { driverId: "d2", driverName: "Driver Two", totalCents: -200 },
    ]);
  });

  it("scopes monthly transactions to tenant and month window", async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "tx1",
        amountCents: 100,
        type: "PAYOUT",
        createdAt: new Date("2026-05-10"),
      },
    ]);
    const prisma: any = {
      driverWalletTransaction: { findMany, groupBy: jest.fn() },
      drivers: { findMany: jest.fn() },
    };
    const svc = new FinanceService(prisma);
    const rows = await svc.getDriverWalletTransactions(
      "tenant-a",
      "driver-1",
      "2026-05",
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          driverId: "driver-1",
          driver: { tenantId: "tenant-a" },
          createdAt: expect.objectContaining({
            gte: expect.any(Date),
            lt: expect.any(Date),
          }),
        }),
      }),
    );
    expect(rows[0]).toMatchObject({
      id: "tx1",
      amountCents: 100,
      type: "PAYOUT",
      referenceId: null,
    });
  });
});

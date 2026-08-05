import { JobStatus, TripStatus } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";
import { StatisticsFinanceQueryDto } from "./dto";
import { StatisticsFinanceService } from "./statistics-finance.service";

function query(
  input: Partial<StatisticsFinanceQueryDto> = {},
): StatisticsFinanceQueryDto {
  return Object.assign(new StatisticsFinanceQueryDto(), {
    from: "2026-08-01",
    to: "2026-08-01",
    ...input,
  });
}

function createPrismaMock() {
  return {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({
        timezone: "Asia/Singapore",
      }),
    },
    job: { findMany: jest.fn() },
    trip: { findMany: jest.fn() },
    jobCharge: { groupBy: jest.fn() },
    tripPayoutLine: { findMany: jest.fn() },
    invoice: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

function setEmptyResults(prisma: ReturnType<typeof createPrismaMock>) {
  prisma.job.findMany.mockResolvedValue([]);
  prisma.invoice.groupBy.mockResolvedValue([]);
}

describe("StatisticsFinanceService", () => {
  it("aggregates canonical sources into isolated deterministic currency groups", async () => {
    const prisma = createPrismaMock();
    prisma.job.findMany
      .mockResolvedValueOnce([{ id: "job-1" }, { id: "job-2" }])
      .mockResolvedValueOnce([{ id: "job-3" }]);
    prisma.trip.findMany.mockResolvedValue([
      {
        id: "trip-1",
        jobId: "job-1",
        status: TripStatus.COMPLETED,
        closedAt: new Date("2026-08-01T04:00:00.000Z"),
      },
      {
        id: "trip-cancelled",
        jobId: "job-1",
        status: TripStatus.CANCELLED,
        closedAt: null,
      },
      {
        id: "trip-2",
        jobId: "job-2",
        status: TripStatus.DONE,
        closedAt: new Date("2026-08-01T05:00:00.000Z"),
      },
    ]);
    prisma.tripPayoutLine.findMany.mockResolvedValue([
      {
        tripId: "trip-1",
        totalCents: 3_000,
        amountCents: null,
        quantity: 1,
        isSelectableForTripEarning: true,
      },
      {
        tripId: "trip-1",
        totalCents: 99_999,
        amountCents: null,
        quantity: 1,
        isSelectableForTripEarning: false,
      },
    ]);
    prisma.jobCharge.groupBy
      .mockResolvedValueOnce([
        {
          jobId: "job-1",
          currency: "sgd",
          _sum: { amountCents: 10_000 },
          _count: { _all: 2 },
        },
        {
          jobId: "job-2",
          currency: "USD",
          _sum: { amountCents: 5_000 },
          _count: { _all: 1 },
        },
      ])
      .mockResolvedValueOnce([
        {
          jobId: "job-3",
          currency: "usd",
          _sum: { amountCents: 2_000 },
        },
      ]);
    prisma.invoice.groupBy
      .mockResolvedValueOnce([
        { currency: "SGD", _sum: { totalCents: 15_000 } },
        { currency: "usd", _sum: { totalCents: 10_000 } },
      ])
      .mockResolvedValueOnce([
        { currency: "SGD", _sum: { totalCents: 5_000 } },
      ]);
    prisma.invoice.findMany.mockResolvedValue([]);

    const result = await new StatisticsFinanceService(
      prisma as any,
    ).getFinance("tenant-1", query());

    expect(result.timeZone).toBe("Asia/Singapore");
    expect(result.currencyGroups).toEqual([
      {
        currency: "SGD",
        jobChargesCents: 10_000,
        issuedInvoiceValueCents: 15_000,
        paidInvoiceValueCents: 5_000,
        uninvoicedReadyValueCents: 0,
        recordedTripPayoutCents: 3_000,
        attributableJobPayoutCents: 3_000,
        grossProfitCents: 7_000,
        grossMarginBasisPoints: 7_000,
      },
      {
        currency: "USD",
        jobChargesCents: 5_000,
        issuedInvoiceValueCents: 10_000,
        paidInvoiceValueCents: 0,
        uninvoicedReadyValueCents: 2_000,
        recordedTripPayoutCents: 0,
        attributableJobPayoutCents: 0,
        grossProfitCents: null,
        grossMarginBasisPoints: null,
      },
    ]);
    expect(result.exceptionCounts).toEqual({
      completedJobsMissingCharges: 0,
      completedTripsMissingPayouts: 1,
      excludedFromProfit: 1,
    });
    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "job_charges_are_mutable",
        "trip_payout_lines_are_mutable",
        "payout_currency_assumed_sgd",
        "paid_invoice_date_uses_updated_at",
      ]),
    );

    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-1",
          jobId: { in: ["job-1", "job-2"] },
        },
      }),
    );
    expect(prisma.tripPayoutLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-1",
          tripId: {
            in: ["trip-1", "trip-2"],
          },
        },
      }),
    );
    expect(
      prisma.jobCharge.groupBy.mock.calls[0][0].where,
    ).toEqual({
      tenantId: "tenant-1",
      jobId: { in: ["job-1", "job-2"] },
    });
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-1",
          sourceJobId: { in: ["job-3"] },
        }),
      }),
    );
  });

  it("uses authoritative inclusive/exclusive dates for each financial cohort", async () => {
    const prisma = createPrismaMock();
    setEmptyResults(prisma);
    await new StatisticsFinanceService(prisma as any).getFinance(
      "tenant-1",
      query(),
    );
    const gte = new Date("2026-07-31T16:00:00.000Z");
    const lt = new Date("2026-08-01T16:00:00.000Z");
    const candidateWhere = prisma.job.findMany.mock.calls[0][0].where;
    expect(candidateWhere.trips.some.closedAt).toEqual({ gte, lt });

    const issuedWhere = prisma.invoice.groupBy.mock.calls[0][0].where;
    expect(issuedWhere).toMatchObject({
      tenantId: "tenant-1",
      OR: [
        { issuedAt: { gte, lt } },
        { issuedAt: null, sentAt: { gte, lt } },
        {
          issuedAt: null,
          sentAt: null,
          issueDate: { gte, lt },
        },
      ],
    });
    const paidWhere = prisma.invoice.groupBy.mock.calls[1][0].where;
    expect(paidWhere).toMatchObject({
      tenantId: "tenant-1",
      status: "Paid",
      updatedAt: { gte, lt },
    });
    const readyWhere = prisma.job.findMany.mock.calls[1][0].where;
    expect(readyWhere).toMatchObject({
      tenantId: "tenant-1",
      status: JobStatus.READY_FOR_INVOICE,
      invoiceReadyAt: { gte, lt },
    });
    expect(JSON.stringify(readyWhere)).not.toContain("updatedAt");
  });

  it("keeps missing charges and payouts distinguishable from zero money", async () => {
    const prisma = createPrismaMock();
    prisma.job.findMany
      .mockResolvedValueOnce([{ id: "job-1" }])
      .mockResolvedValueOnce([]);
    prisma.trip.findMany.mockResolvedValue([
      {
        id: "trip-1",
        jobId: "job-1",
        status: TripStatus.COMPLETED,
        closedAt: new Date("2026-08-01T04:00:00.000Z"),
      },
    ]);
    prisma.jobCharge.groupBy.mockResolvedValue([]);
    prisma.tripPayoutLine.findMany.mockResolvedValue([]);
    prisma.invoice.groupBy.mockResolvedValue([]);

    const result = await new StatisticsFinanceService(
      prisma as any,
    ).getFinance("tenant-1", query());

    expect(result.currencyGroups).toEqual([]);
    expect(result.exceptionCounts).toEqual({
      completedJobsMissingCharges: 1,
      completedTripsMissingPayouts: 1,
      excludedFromProfit: 1,
    });
  });

  it("excludes multi-currency jobs from profit without cross-summing", async () => {
    const prisma = createPrismaMock();
    prisma.job.findMany
      .mockResolvedValueOnce([{ id: "job-1" }])
      .mockResolvedValueOnce([]);
    prisma.trip.findMany.mockResolvedValue([
      {
        id: "trip-1",
        jobId: "job-1",
        status: TripStatus.COMPLETED,
        closedAt: new Date("2026-08-01T04:00:00.000Z"),
      },
    ]);
    prisma.tripPayoutLine.findMany.mockResolvedValue([
      {
        tripId: "trip-1",
        totalCents: 1_000,
        amountCents: null,
        quantity: 1,
        isSelectableForTripEarning: true,
      },
    ]);
    prisma.jobCharge.groupBy.mockResolvedValueOnce([
      {
        jobId: "job-1",
        currency: "SGD",
        _sum: { amountCents: 5_000 },
        _count: { _all: 1 },
      },
      {
        jobId: "job-1",
        currency: "USD",
        _sum: { amountCents: 2_000 },
        _count: { _all: 1 },
      },
    ]);
    prisma.invoice.groupBy.mockResolvedValue([]);

    const result = await new StatisticsFinanceService(
      prisma as any,
    ).getFinance("tenant-1", query());

    expect(result.currencyGroups.map((group) => group.currency)).toEqual([
      "SGD",
      "USD",
    ]);
    expect(
      result.currencyGroups.every(
        (group) =>
          group.grossProfitCents === null &&
          group.grossMarginBasisPoints === null,
      ),
    ).toBe(true);
    expect(result.exceptionCounts.excludedFromProfit).toBe(1);
    expect(result.limitations).toContain(
      "profit_currency_mismatches_excluded",
    );
  });

  it("returns null margin for nonpositive eligible revenue", async () => {
    const prisma = createPrismaMock();
    prisma.job.findMany
      .mockResolvedValueOnce([{ id: "job-1" }])
      .mockResolvedValueOnce([]);
    prisma.trip.findMany.mockResolvedValue([
      {
        id: "trip-1",
        jobId: "job-1",
        status: TripStatus.COMPLETED,
        closedAt: new Date("2026-08-01T04:00:00.000Z"),
      },
    ]);
    prisma.tripPayoutLine.findMany.mockResolvedValue([
      {
        tripId: "trip-1",
        totalCents: 100,
        amountCents: null,
        quantity: 1,
        isSelectableForTripEarning: true,
      },
    ]);
    prisma.jobCharge.groupBy.mockResolvedValueOnce([
      {
        jobId: "job-1",
        currency: "SGD",
        _sum: { amountCents: 0 },
        _count: { _all: 1 },
      },
    ]);
    prisma.invoice.groupBy.mockResolvedValue([]);

    const result = await new StatisticsFinanceService(
      prisma as any,
    ).getFinance("tenant-1", query());

    expect(result.currencyGroups[0]).toMatchObject({
      currency: "SGD",
      grossProfitCents: -100,
      grossMarginBasisPoints: null,
    });
    expect(result.limitations).toContain(
      "gross_margin_unavailable_for_nonpositive_eligible_revenue",
    );
  });

  it("excludes invalid currencies with an explicit limitation", async () => {
    const prisma = createPrismaMock();
    prisma.job.findMany.mockResolvedValue([]);
    prisma.invoice.groupBy
      .mockResolvedValueOnce([
        { currency: "  ", _sum: { totalCents: 1_000 } },
      ])
      .mockResolvedValueOnce([]);

    const result = await new StatisticsFinanceService(
      prisma as any,
    ).getFinance("tenant-1", query());

    expect(result.currencyGroups).toEqual([]);
    expect(result.limitations).toContain(
      "invalid_currency_records_excluded",
    );
  });

  it("applies customer and job filters through tenant-scoped canonical jobs", async () => {
    const prisma = createPrismaMock();
    setEmptyResults(prisma);
    await new StatisticsFinanceService(prisma as any).getFinance(
      "tenant-1",
      query({
        customerId: "customer-other-tenant",
        jobId: "job-other-tenant",
      }),
    );

    expect(prisma.job.findMany).toHaveBeenCalledTimes(3);
    for (const call of prisma.job.findMany.mock.calls) {
      expect(call[0].where).toMatchObject({
        tenantId: "tenant-1",
        id: "job-other-tenant",
        customerCompanyId: "customer-other-tenant",
      });
    }
    expect(prisma.trip.findMany).not.toHaveBeenCalled();
    expect(prisma.jobCharge.groupBy).not.toHaveBeenCalled();
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    expect(prisma.invoice.groupBy).not.toHaveBeenCalled();
  });

  it("keeps every independent query tenant-scoped and batched", async () => {
    const prisma = createPrismaMock();
    prisma.job.findMany
      .mockResolvedValueOnce([{ id: "job-1" }])
      .mockResolvedValueOnce([{ id: "job-1" }])
      .mockResolvedValueOnce([{ id: "job-2" }]);
    prisma.trip.findMany.mockResolvedValue([]);
    prisma.jobCharge.groupBy.mockResolvedValue([]);
    prisma.invoice.groupBy.mockResolvedValue([]);
    prisma.invoice.findMany.mockResolvedValue([]);

    await new StatisticsFinanceService(prisma as any).getFinance(
      "tenant-1",
      query({ customerId: "customer-1" }),
    );

    for (const call of prisma.job.findMany.mock.calls) {
      expect(call[0].where.tenantId).toBe("tenant-1");
      expect(call[0].take).toBe(200);
    }
    for (const call of prisma.jobCharge.groupBy.mock.calls) {
      expect(call[0].where.tenantId).toBe("tenant-1");
    }
    for (const call of prisma.invoice.groupBy.mock.calls) {
      expect(call[0].where.tenantId).toBe("tenant-1");
      expect(call[0].where.sourceJobId).toEqual({
        in: ["job-1"],
      });
    }
    expect(prisma.trip.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.tripPayoutLine.findMany).not.toHaveBeenCalled();
  });

  it("introduces no raw SQL, legacy money, or denormalized payout source", () => {
    const source = readFileSync(
      join(__dirname, "statistics-finance.service.ts"),
      "utf8",
    );
    expect(source).not.toContain("$queryRaw");
    expect(source).not.toContain("$queryRawUnsafe");
    expect(source).not.toContain("driverEarningCents");
    expect(source).not.toContain("invoiceLineItem");
    expect(source).not.toContain("TransportOrder");
    expect(source).not.toContain("Stop");
  });

  it("does not accept unsupported finance filter properties", () => {
    const dto = new StatisticsFinanceQueryDto();
    expect(dto).not.toHaveProperty("tripId");
    expect(dto).not.toHaveProperty("driverId");
    expect(dto).not.toHaveProperty("vehicleId");
    expect(dto).not.toHaveProperty("currency");
    expect(dto).not.toHaveProperty("tenantId");
    expect(dto).not.toHaveProperty("routeId");
    expect(dto).not.toHaveProperty("trailerId");
  });
});

import { ConflictException, PayloadTooLargeException } from "@nestjs/common";
import {
  MAX_STATISTICS_EXPORT_ROWS,
  StatisticsExportService,
} from "./statistics-export.service";

describe("StatisticsExportService", () => {
  function makeService() {
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }),
      },
    };
    const drivers = { getDrivers: jest.fn() };
    const finance = { getFinance: jest.fn() };
    const exceptions = { getExceptionsForExport: jest.fn() };
    const service = new StatisticsExportService(
      prisma as any,
      drivers as any,
      finance as any,
      exceptions as any,
    );
    return { service, prisma, drivers, finance, exceptions };
  }

  const driverRow = (id: string) => ({
    driverUserId: id,
    driverName: id === "d1" ? '=Formula, "Name"\n新' : `Driver ${id}`,
    completedTrips: 0,
    completedJobs: 1,
    totalValidDurationMs: Number.MAX_SAFE_INTEGER,
    avgDurationMs: null,
    cancelledTrips: 0,
    reassignmentCount: 2,
    requiredDocumentCompletionRateBasisPoints: 0,
    limitations: ["z_unknown", "a_known"],
  });

  it("exports every Drivers page in authoritative order without truncation", async () => {
    const { service, drivers } = makeService();
    const firstRows = Array.from({ length: 100 }, (_, index) =>
      driverRow(`d${index + 1}`),
    );
    drivers.getDrivers
      .mockResolvedValueOnce({
        data: firstRows,
        meta: { page: 1, pageSize: 100, total: 101 },
        limitations: ["response_limit"],
      })
      .mockResolvedValueOnce({
        data: [driverRow("d101")],
        meta: { page: 2, pageSize: 100, total: 101 },
        limitations: ["response_limit"],
      });

    const result = await service.exportDrivers("tenant-a", {
      from: "2026-08-01",
      to: "2026-08-31",
      sortBy: "completedTrips",
      sortDir: "desc",
    });

    expect(result.rowCount).toBe(101);
    expect(result.filename).toBe(
      "opsflow-statistics-drivers-2026-08-01-to-2026-08-31.csv",
    );
    expect(drivers.getDrivers).toHaveBeenNthCalledWith(
      2,
      "tenant-a",
      expect.objectContaining({ page: 2, pageSize: 100 }),
    );
    const text = result.body.toString("utf8");
    expect(text).toContain(`"'=Formula, ""Name""\n新"`);
    expect(text).toContain('"9007199254740991",""');
    expect(text).toContain('"a_known | z_unknown"');
  });

  it("returns only a header for an empty Drivers export", async () => {
    const { service, drivers } = makeService();
    drivers.getDrivers.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 100, total: 0 },
      limitations: [],
    });
    const result = await service.exportDrivers("tenant-a", {});
    expect(result.rowCount).toBe(0);
    expect(result.body.toString("utf8").trim().split("\r\n")).toHaveLength(1);
  });

  it("rejects over-limit or concurrently changed Drivers data", async () => {
    const over = makeService();
    over.drivers.getDrivers.mockResolvedValue({
      data: [],
      meta: {
        page: 1,
        pageSize: 100,
        total: MAX_STATISTICS_EXPORT_ROWS + 1,
      },
      limitations: [],
    });
    await expect(
      over.service.exportDrivers("tenant-a", {}),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);

    const changed = makeService();
    changed.drivers.getDrivers
      .mockResolvedValueOnce({
        data: Array.from({ length: 100 }, (_, index) =>
          driverRow(`d${index + 1}`),
        ),
        meta: { page: 1, pageSize: 100, total: 101 },
        limitations: [],
      })
      .mockResolvedValueOnce({
        data: [driverRow("d101")],
        meta: { page: 2, pageSize: 100, total: 102 },
        limitations: [],
      });
    await expect(
      changed.service.exportDrivers("tenant-a", {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("exports Finance currency groups separately without inferring rows", async () => {
    const { service, finance } = makeService();
    finance.getFinance.mockResolvedValue({
      currencyGroups: [
        {
          currency: "SGD",
          jobChargesCents: 100,
          issuedInvoiceValueCents: 80,
          paidInvoiceValueCents: 50,
          uninvoicedReadyValueCents: 20,
          recordedTripPayoutCents: 10,
          attributableJobPayoutCents: 10,
          grossProfitCents: 70,
          grossMarginBasisPoints: 8750,
        },
        {
          currency: "USD",
          jobChargesCents: 0,
          issuedInvoiceValueCents: 0,
          paidInvoiceValueCents: 0,
          uninvoicedReadyValueCents: 0,
          recordedTripPayoutCents: 0,
          attributableJobPayoutCents: 0,
          grossProfitCents: null,
          grossMarginBasisPoints: null,
        },
      ],
      exceptionCounts: {
        completedJobsMissingCharges: 1,
        completedTripsMissingPayouts: 2,
        excludedFromProfit: 3,
      },
      limitations: ["paid_invoice_date_uses_paid_at"],
    });

    const result = await service.exportFinance("tenant-a", {
      from: "2026-08-01",
      to: "2026-08-31",
    });
    const text = result.body.toString("utf8");
    expect(result.rowCount).toBe(2);
    expect(text).toContain('"SGD","100"');
    expect(text).toContain('"USD","0"');
    expect(text).toContain('"USD","0","0","0","0","0","0","",""');
    expect(finance.getFinance).toHaveBeenCalledTimes(1);
  });

  it("preserves Finance metadata when there are no currency groups", async () => {
    const { service, finance } = makeService();
    finance.getFinance.mockResolvedValue({
      currencyGroups: [],
      exceptionCounts: {
        completedJobsMissingCharges: 1,
        completedTripsMissingPayouts: 0,
        excludedFromProfit: 0,
      },
      limitations: ["limited"],
    });
    const result = await service.exportFinance("tenant-a", {});
    expect(result.rowCount).toBe(1);
    expect(result.body.toString("utf8")).toContain(
      '"","","","","","","","","","1","0","0","limited"',
    );
  });

  it("exports complete bounded Exceptions and rejects over-limit totals", async () => {
    const ok = makeService();
    ok.exceptions.getExceptionsForExport.mockResolvedValue({
      data: [
        {
          key: "ex_cancelled_trip",
          severity: "LOW",
          entityType: "TRIP",
          entityId: "trip-1",
          jobId: null,
          tripId: "trip-1",
          invoiceId: null,
          reportingTimestamp: null,
          explanation: "@danger\nUnicode 路",
          href: "/trips/trip-1",
          resolvableInOpsFlow: false,
        },
      ],
      meta: { page: 1, pageSize: 10001, total: 1 },
      countsByKey: [],
      limitations: ["snapshot_limit"],
    });
    const result = await ok.service.exportExceptions("tenant-a", {
      sortBy: "severity",
      sortDir: "asc",
    });
    expect(result.rowCount).toBe(1);
    expect(result.body.toString("utf8")).toContain(`"'@danger\nUnicode 路"`);
    expect(ok.exceptions.getExceptionsForExport).toHaveBeenCalledWith(
      "tenant-a",
      expect.objectContaining({ sortBy: "severity", sortDir: "asc" }),
      MAX_STATISTICS_EXPORT_ROWS,
    );

    const over = makeService();
    over.exceptions.getExceptionsForExport.mockResolvedValue({
      data: [],
      meta: {
        page: 1,
        pageSize: 10001,
        total: MAX_STATISTICS_EXPORT_ROWS + 1,
      },
      countsByKey: [],
      limitations: [],
    });
    await expect(
      over.service.exportExceptions("tenant-a", {}),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });
});

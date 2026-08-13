import { ConflictException, PayloadTooLargeException } from "@nestjs/common";
import ExcelJS from "exceljs";
import {
  MAX_STATISTICS_EXPORT_ROWS,
  StatisticsExportService,
} from "./statistics-export.service";

describe("StatisticsExportService", () => {
  function makeService() {
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          timezone: "Asia/Singapore",
          name: "Demo Haulage",
        }),
      },
    };
    const drivers = { getDrivers: jest.fn() };
    const finance = { getFinance: jest.fn() };
    const exceptions = { getExceptionsForExport: jest.fn() };
    const trucking = {
      getSummary: jest.fn(),
      getAllMovements: jest.fn(),
      getAllContainers: jest.fn(),
      getAllLanes: jest.fn(),
      getAllFleet: jest.fn(),
    };
    const customers = { getAllCustomers: jest.fn() };
    const overview = { getOverview: jest.fn() };
    const service = new StatisticsExportService(
      prisma as any,
      drivers as any,
      finance as any,
      exceptions as any,
      trucking as any,
      customers as any,
      overview as any,
    );
    return { service, prisma, drivers, finance, exceptions };
  }

  const driverRow = (id: string) => ({
    driverUserId: id,
    driverName: id === "d1" ? "Test Driver Derek" : `Driver ${id}`,
    completedTrips: 4,
    completedJobs: 4,
    uniqueContainers: 3,
    containerMovements: 6,
    activeDays: 2,
    avgTripsPerActiveDay: 2,
    totalValidDurationMs: 132_826,
    avgDurationMs: 133_000,
    cancelledTrips: 0,
    reassignmentCount: 0,
    requiredDocumentCompletionRateBasisPoints: 9500,
    limitations: ["z_unknown", "a_known"],
  });

  it("exports Drivers as Excel without Driver ID or duration-ms columns", async () => {
    const { service, drivers } = makeService();
    drivers.getDrivers.mockResolvedValue({
      data: [driverRow("d1")],
      meta: { page: 1, pageSize: 100, total: 1 },
      limitations: ["active_assignments_are_current_snapshot"],
    });

    const result = await service.exportDrivers("tenant-a", {
      from: "2026-08-01",
      to: "2026-08-31",
      sortBy: "completedTrips",
      sortDir: "desc",
    });

    expect(result.filename).toBe("OpsFlow-Drivers-2026-08.xlsx");
    expect(result.contentType).toContain("spreadsheetml");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.body as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Drivers")!;
    const header = String(sheet.getRow(7).values);
    expect(header).toContain("Driver");
    expect(header).not.toContain("Driver ID");
    expect(header).not.toContain("Total Valid Duration Ms");
    expect(header).not.toContain("Response Limitations");
    expect(sheet.getCell("A8").value).toBe("Test Driver Derek");
  });

  it("pages Drivers export and rejects unstable totals", async () => {
    const { service, drivers } = makeService();
    const firstRows = Array.from({ length: 100 }, (_, index) =>
      driverRow(`d${index + 1}`),
    );
    drivers.getDrivers
      .mockResolvedValueOnce({
        data: firstRows,
        meta: { page: 1, pageSize: 100, total: 101 },
        limitations: [],
      })
      .mockResolvedValueOnce({
        data: [driverRow("d101")],
        meta: { page: 2, pageSize: 100, total: 99 },
        limitations: [],
      });

    await expect(
      service.exportDrivers("tenant-a", {
        from: "2026-08-01",
        to: "2026-08-31",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects oversized exports", async () => {
    const { service, drivers } = makeService();
    drivers.getDrivers.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 100, total: MAX_STATISTICS_EXPORT_ROWS + 1 },
      limitations: [],
    });
    await expect(
      service.exportDrivers("tenant-a", { from: "2026-08-01", to: "2026-08-31" }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it("exports Finance with numeric currency cells and no basis-point headers", async () => {
    const { service, finance } = makeService();
    finance.getFinance.mockResolvedValue({
      currencyGroups: [
        {
          currency: "SGD",
          jobChargesCents: 50000,
          issuedInvoiceValueCents: 54500,
          paidInvoiceValueCents: 0,
          uninvoicedReadyValueCents: 0,
          recordedTripPayoutCents: 20000,
          attributableJobPayoutCents: 20000,
          grossProfitCents: 30000,
          grossMarginBasisPoints: 6000,
        },
      ],
      limitations: ["quotation_totals_are_not_revenue"],
      exceptionCounts: {
        completedJobsMissingCharges: 0,
        completedTripsMissingPayouts: 0,
        excludedFromProfit: 0,
      },
    });
    const result = await service.exportFinance("tenant-a", {
      from: "2026-08-01",
      to: "2026-08-31",
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.body as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Finance")!;
    expect(String(sheet.getRow(7).values)).not.toContain("Gross Margin Basis Points");
    expect(sheet.getCell("B8").value).toBe(500);
    expect(sheet.getCell("G8").value).toBe(300);
    expect(sheet.getCell("H8").value).toBeCloseTo(0.6);
  });
});

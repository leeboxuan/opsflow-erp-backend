import {
  ConflictException,
  InternalServerErrorException,
  Logger,
  PayloadTooLargeException,
} from "@nestjs/common";
import ExcelJS from "exceljs";
import { buildStatisticsExcelWorkbook } from "./statistics-excel";
import {
  MAX_STATISTICS_EXPORT_ROWS,
  StatisticsExportService,
} from "./statistics-export.service";

jest.mock("./statistics-excel", () => {
  const actual = jest.requireActual("./statistics-excel");
  return {
    ...actual,
    buildStatisticsExcelWorkbook: jest.fn((input: unknown) =>
      actual.buildStatisticsExcelWorkbook(input),
    ),
  };
});

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
    return {
      service,
      prisma,
      drivers,
      finance,
      exceptions,
      trucking,
      customers,
      overview,
    };
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

  it("exports the management workbook with every intended dataset exactly once", async () => {
    const {
      service,
      prisma,
      overview,
      trucking,
      drivers,
      customers,
      finance,
      exceptions,
    } = makeService();
    const query = { from: "2026-07-20", to: "2026-08-18" };
    overview.getOverview.mockResolvedValue({
      timeZone: "Asia/Singapore",
      generatedAt: new Date("2026-08-18T04:00:00.000Z"),
      limitations: [],
      completedTrips: 12,
      operationallyCompletedJobs: 9,
      activePendingTrips: 2,
      cancelledTrips: 1,
      uniqueContainers: 7,
      containerMovements: 15,
    });
    trucking.getSummary.mockResolvedValue({
      timeZone: "Asia/Singapore",
      generatedAt: new Date("2026-08-18T04:00:00.000Z"),
      limitations: [],
      uniqueContainers: 7,
      containerMovements: 15,
      averageMovementsPerContainer: 2.14,
      containersHandledByMultipleDrivers: 1,
      jobs: 9,
      completedTrips: 12,
      cancelledTrips: 1,
      avgTripDurationMs: 1000,
      importContainers: 4,
      exportContainers: 2,
      lclContainers: 1,
      collectionContainers: 0,
      containerSizeMix: [],
      jobTypeMix: [],
    });
    trucking.getAllMovements.mockResolvedValue([]);
    trucking.getAllContainers.mockResolvedValue([]);
    trucking.getAllFleet.mockResolvedValue({ vehicles: [] });
    drivers.getDrivers.mockResolvedValue({
      data: [driverRow("d1")],
      meta: { page: 1, pageSize: 100, total: 1 },
      limitations: [],
    });
    customers.getAllCustomers.mockResolvedValue([
      {
        customerName: "Acme",
        jobs: 2,
        completedJobs: 2,
        uniqueContainers: 3,
        containerMovements: 4,
        completedTrips: 4,
        cancelledTrips: 0,
        averageMovementsPerContainer: 2,
        jobTypeMix: "IMPORT",
        currencyGroups: [
          {
            currency: "SGD",
            jobChargesCents: 50_000,
            issuedInvoiceValueCents: 50_000,
            paidInvoiceValueCents: 0,
            uninvoicedReadyValueCents: 0,
            recordedDriverPayoutCents: 20_000,
            grossProfitCents: 30_000,
            grossMarginBasisPoints: 6000,
          },
        ],
        profitAggregationAvailable: true,
      },
    ]);
    finance.getFinance.mockResolvedValue({
      currencyGroups: [
        {
          currency: "SGD",
          jobChargesCents: 50_000,
          issuedInvoiceValueCents: 54_500,
          paidInvoiceValueCents: 0,
          uninvoicedReadyValueCents: 0,
          recordedTripPayoutCents: 20_000,
          attributableJobPayoutCents: 20_000,
          grossProfitCents: 30_000,
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
    exceptions.getExceptionsForExport.mockResolvedValue({
      data: [
        {
          key: "ex_job_missing_charges",
          severity: "WARNING",
          entityType: "JOB",
          entityId: "job-1",
          jobId: "job-1",
          tripId: null,
          invoiceId: null,
          jobNo: "JOB-1",
          tripRef: null,
          containerNo: null,
          customerName: "Acme",
          driverName: null,
          invoiceNo: null,
          reportingTimestamp: new Date("2026-08-01T00:00:00.000Z"),
          explanation: "Missing charges",
          href: "/jobs/job-1",
          resolvableInOpsFlow: true,
        },
      ],
      meta: { page: 1, pageSize: 100, total: 1 },
      limitations: [],
    });

    const result = await service.exportManagement("tenant-a", query);
    expect(result.body.slice(0, 2).toString("utf8")).toBe("PK");
    expect(result.filename).toContain("2026-07-20");
    expect(result.filename).toContain("2026-08-18");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.body as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Management Summary",
      "Operational Summary",
      "Container Movements",
      "Containers",
      "Drivers",
      "Customers",
      "Fleet",
      "Finance",
      "Exceptions",
      "Notes",
    ]);

    const management = workbook.getWorksheet("Management Summary")!;
    expect(String(management.getCell("B2").value)).toContain("Demo Haulage");
    expect(String(management.getCell("B3").value)).toBe(
      "2026-07-20 to 2026-08-18",
    );
    expect(management.getCell("A8").value).toBe("Jobs completed");
    expect(String(management.getCell("B8").value)).toBe("9");
    expect(String(workbook.getWorksheet("Operational Summary")!.getCell("B8").value)).toBe(
      "7",
    );
    expect(workbook.getWorksheet("Finance")!.getCell("B8").value).toBe(500);
    expect(workbook.getWorksheet("Drivers")!.getCell("A8").value).toBe(
      "Test Driver Derek",
    );
    expect(workbook.getWorksheet("Customers")!.getCell("A8").value).toBe("Acme");
    expect(workbook.getWorksheet("Exceptions")!.getCell("D8").value).toBe(
      "JOB-1",
    );

    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: "tenant-a" },
      select: { timezone: true, name: true },
    });
    expect(overview.getOverview).toHaveBeenCalledWith("tenant-a", query);
    expect(trucking.getSummary).toHaveBeenCalledWith("tenant-a", query);
    expect(finance.getFinance).toHaveBeenCalledWith("tenant-a", query);
    expect(exceptions.getExceptionsForExport).toHaveBeenCalledWith(
      "tenant-a",
      query,
      MAX_STATISTICS_EXPORT_ROWS,
    );
  });

  it("omits Finance when includeFinance is false and does not call Finance", async () => {
    const { service, trucking, overview, drivers, customers, finance, exceptions } =
      makeService();
    overview.getOverview.mockResolvedValue({
      timeZone: "Asia/Singapore",
      generatedAt: new Date(),
      limitations: [],
      completedTrips: 0,
      operationallyCompletedJobs: 0,
      activePendingTrips: 0,
      cancelledTrips: 0,
      uniqueContainers: 0,
      containerMovements: 0,
    });
    trucking.getSummary.mockResolvedValue({
      timeZone: "Asia/Singapore",
      generatedAt: new Date(),
      limitations: [],
      uniqueContainers: 0,
      containerMovements: 0,
      averageMovementsPerContainer: null,
      containersHandledByMultipleDrivers: 0,
      jobs: 0,
      completedTrips: 0,
      cancelledTrips: 0,
      avgTripDurationMs: null,
      importContainers: 0,
      exportContainers: 0,
      lclContainers: 0,
      collectionContainers: 0,
      containerSizeMix: [],
      jobTypeMix: [],
    });
    trucking.getAllMovements.mockResolvedValue([]);
    trucking.getAllContainers.mockResolvedValue([]);
    trucking.getAllFleet.mockResolvedValue({ vehicles: [] });
    drivers.getDrivers.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 100, total: 0 },
      limitations: [],
    });
    customers.getAllCustomers.mockResolvedValue([]);
    exceptions.getExceptionsForExport.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 100, total: 0 },
      limitations: [],
    });

    const result = await service.exportManagement(
      "tenant-a",
      { from: "2026-07-20", to: "2026-08-18" },
      { includeFinance: false },
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.body as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Management Summary",
      "Operational Summary",
      "Container Movements",
      "Containers",
      "Drivers",
      "Customers",
      "Fleet",
      "Exceptions",
      "Notes",
    ]);
    expect(finance.getFinance).not.toHaveBeenCalled();
  });

  it("returns a safe error when workbook construction fails", async () => {
    const { service, finance } = makeService();
    finance.getFinance.mockResolvedValue({
      currencyGroups: [],
      limitations: [],
      exceptionCounts: {
        completedJobsMissingCharges: 0,
        completedTripsMissingPayouts: 0,
        excludedFromProfit: 0,
      },
    });
    const log = jest.spyOn(Logger.prototype, "error").mockImplementation();
    (buildStatisticsExcelWorkbook as jest.Mock).mockRejectedValueOnce(
      new Error("Worksheet name already exists: Summary"),
    );

    try {
      await service.exportFinance("tenant-a", {
        from: "2026-07-20",
        to: "2026-08-18",
      });
      throw new Error("expected exportFinance to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).message).toBe(
        "Failed to build Statistics workbook",
      );
      expect(String(error)).not.toContain("Worksheet name already exists");
    }

    expect(log).toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toBe("Failed to build Statistics workbook");
    expect(String(log.mock.calls[0][1])).toContain(
      "Worksheet name already exists: Summary",
    );
    log.mockRestore();
  });
});

import ExcelJS from "exceljs";
import { buildStatisticsExcelWorkbook } from "./statistics-excel";
import {
  containersSheet,
  customersSheet,
  driversSheet,
  exceptionsSheet,
  financeSheet,
  fleetSheet,
  movementsSheet,
  overviewSummarySheet,
  STATISTICS_REPORT_DEFINITIONS,
  truckingSummarySheet,
  workbookInput,
} from "./statistics-excel-reports";
import { EXCEL_WORKSHEET_NAME_MAX } from "./statistics-excel-sheet-names";

function metricSheet(name: string, value = 1) {
  return {
    name,
    columns: [
      {
        header: "Metric",
        width: 20,
        type: "text" as const,
        value: (row: { metric: string }) => row.metric,
      },
      {
        header: "Value",
        width: 12,
        type: "integer" as const,
        value: (row: { value: number }) => row.value,
      },
    ],
    rows: [{ metric: "Count", value }],
  };
}

function workbookBase() {
  return {
    title: "OpsFlow — Management Report",
    companyName: "Demo Haulage",
    periodFrom: "2026-07-20",
    periodTo: "2026-08-18",
    generatedAt: new Date("2026-08-18T04:00:00.000Z"),
    timeZone: "Asia/Singapore",
    filters: [],
    limitations: [],
  };
}

describe("Statistics Excel workbook", () => {
  it("writes a management workbook with numeric money/percent and no internal columns", async () => {
    const body = await buildStatisticsExcelWorkbook(
      workbookInput({
        title: "OpsFlow — Drivers Report",
        companyName: "Demo Haulage",
        periodFrom: "2026-08-01",
        periodTo: "2026-08-31",
        generatedAt: new Date("2026-08-14T04:00:00.000Z"),
        timeZone: "Asia/Singapore",
        filters: ["Customer Acme"],
        limitations: [
          "cancelled_trip_date_uses_updated_at",
          "active_assignments_are_current_snapshot",
        ],
        sheets: [
          driversSheet([
            {
              driverUserId: "cmq6mfjv400ci13d5slwykuhc",
              driverName: "Test Driver Derek",
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
              limitations: [],
            },
          ]),
          financeSheet([
            {
              currency: "SGD",
              jobChargesCents: 1_542_000,
              issuedInvoiceValueCents: 1_395_000,
              paidInvoiceValueCents: 1_020_000,
              uninvoicedReadyValueCents: 147_000,
              recordedTripPayoutCents: 560_000,
              attributableJobPayoutCents: 560_000,
              grossProfitCents: 982_000,
              grossMarginBasisPoints: 6368,
            },
          ]),
        ],
      }),
    );

    expect(body.slice(0, 2).toString("utf8")).toBe("PK");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(body as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Drivers",
      "Finance",
      "Notes",
    ]);

    const drivers = workbook.getWorksheet("Drivers")!;
    expect(drivers.getCell("A1").value).toBe("OpsFlow — Drivers Report");
    expect(String(drivers.getCell("B2").value)).toContain("Demo Haulage");
    expect(String(drivers.getCell("B3").value)).toContain("2026-08-01");
    const header = drivers.getRow(7).values as Array<string | undefined>;
    expect(header).toContain("Driver");
    expect(header).not.toContain("Driver ID");
    expect(header.join(" ")).not.toContain("Duration Ms");
    expect(header.join(" ")).not.toContain("Basis Points");
    expect(header.join(" ")).not.toContain("Response Limitations");
    expect(drivers.getCell("A8").value).toBe("Test Driver Derek");
    expect(drivers.getCell("B8").value).toBe(4);
    expect(drivers.getColumn(1).width).toBeGreaterThan(10);
    expect(drivers.views?.[0]).toMatchObject({ state: "frozen", ySplit: 7 });
    expect(drivers.autoFilter).toBeTruthy();

    const finance = workbook.getWorksheet("Finance")!;
    const financeHeader = finance.getRow(7).values as Array<string | undefined>;
    expect(financeHeader.join(" ")).not.toContain("Cents");
    expect(financeHeader.join(" ")).not.toContain("Basis Points");
    expect(finance.getCell("A8").value).toBe("SGD");
    expect(finance.getCell("B8").value).toBe(15420);
    expect(String(finance.getCell("B8").numFmt)).toContain("0.00");
    expect(finance.getCell("H8").value).toBeCloseTo(0.6368);
    expect(String(finance.getCell("H8").numFmt)).toContain("%");

    const notes = workbook.getWorksheet("Notes")!;
    const noteText = notes.getSheetValues().join(" ");
    expect(noteText).toContain("Cancelled trip reporting currently uses");
    expect(noteText).not.toContain("cancelled_trip_date_uses_updated_at");
    expect(noteText).toContain(STATISTICS_REPORT_DEFINITIONS[0].slice(0, 20));
    expect(noteText).not.toMatch(/cmq6mfjv400ci13d5slwykuhc/);
  });

  it("serializes two requested Summary sheets without overwriting either dataset", async () => {
    const body = await buildStatisticsExcelWorkbook(
      workbookInput({
        ...workbookBase(),
        sheets: [
          metricSheet("Summary", 11),
          metricSheet("Summary", 22),
        ],
      }),
    );

    expect(body.slice(0, 2).toString("utf8")).toBe("PK");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(body as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Summary",
      "Summary (2)",
      "Notes",
    ]);
    expect(workbook.getWorksheet("Summary")!.getCell("B8").value).toBe(11);
    expect(workbook.getWorksheet("Summary (2)")!.getCell("B8").value).toBe(22);
  });

  it("keeps case-insensitive collisions and invalid or overlong names unique", async () => {
    const longName = "Container Movements Analysis Extra Detail";
    const body = await buildStatisticsExcelWorkbook(
      workbookInput({
        ...workbookBase(),
        sheets: [
          metricSheet("Summary", 1),
          metricSheet("summary", 2),
          metricSheet("Q1:Results?*[copy]", 3),
          metricSheet(longName, 4),
          metricSheet(longName, 5),
          metricSheet("Notes", 6),
        ],
      }),
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(body as unknown as ArrayBuffer);
    const names = workbook.worksheets.map((sheet) => sheet.name);
    expect(names).toEqual([
      "Summary",
      "summary (2)",
      "Q1 Results copy",
      longName.slice(0, EXCEL_WORKSHEET_NAME_MAX),
      `${longName.slice(0, EXCEL_WORKSHEET_NAME_MAX - 4)} (2)`,
      "Notes",
      "Notes (2)",
    ]);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(
      names.length,
    );
    for (const name of names) {
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(EXCEL_WORKSHEET_NAME_MAX);
      expect(name).not.toMatch(/[\\/?*\[\]:]/);
    }
    expect(workbook.getWorksheet("Notes")!.getCell("B8").value).toBe(6);
    expect(workbook.getWorksheet("Notes (2)")!.getCell("A1").value).toBe(
      "Report notes",
    );
  });

  it("preserves every intended management-export dataset under distinct names", async () => {
    const body = await buildStatisticsExcelWorkbook(
      workbookInput({
        ...workbookBase(),
        sheets: [
          overviewSummarySheet({
            timeZone: "Asia/Singapore",
            generatedAt: new Date("2026-08-18T04:00:00.000Z"),
            limitations: [],
            completedTrips: 12,
            operationallyCompletedJobs: 9,
            activePendingTrips: 2,
            cancelledTrips: 1,
            uniqueContainers: 7,
            containerMovements: 15,
          }),
          truckingSummarySheet({
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
          }),
          movementsSheet([]),
          containersSheet([]),
          driversSheet([]),
          customersSheet([]),
          fleetSheet([]),
          financeSheet([
            {
              currency: "SGD",
              jobChargesCents: 50_000,
              issuedInvoiceValueCents: 50_000,
              paidInvoiceValueCents: 0,
              uninvoicedReadyValueCents: 0,
              recordedTripPayoutCents: 20_000,
              attributableJobPayoutCents: 20_000,
              grossProfitCents: 30_000,
              grossMarginBasisPoints: 6000,
            },
          ]),
          exceptionsSheet([]),
        ],
      }),
    );

    expect(body.slice(0, 2).toString("utf8")).toBe("PK");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(body as unknown as ArrayBuffer);
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
    expect(String(management.getCell("B3").value)).toContain("2026-07-20");
    expect(String(management.getCell("B3").value)).toContain("2026-08-18");
    expect(management.getCell("A8").value).toBe("Jobs completed");
    expect(String(management.getCell("B8").value)).toBe("9");
    const operational = workbook.getWorksheet("Operational Summary")!;
    expect(operational.getCell("A8").value).toBe("Unique containers");
    expect(String(operational.getCell("B8").value)).toBe("7");
    expect(workbook.getWorksheet("Finance")!.getCell("B8").value).toBe(500);
  });
});

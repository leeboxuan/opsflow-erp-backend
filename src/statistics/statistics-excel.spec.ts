import ExcelJS from "exceljs";
import { buildStatisticsExcelWorkbook } from "./statistics-excel";
import {
  driversSheet,
  financeSheet,
  STATISTICS_REPORT_DEFINITIONS,
  workbookInput,
} from "./statistics-excel-reports";

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
});

import ExcelJS from "exceljs";
import {
  createExcelWorksheetNameAllocator,
  type ExcelWorksheetNameAllocator,
} from "./statistics-excel-sheet-names";
import { statisticsLimitationNote } from "./statistics-limitation-copy";
import {
  basisPointsToRatio,
  centsToMajorUnits,
  durationMsToExcelDayFraction,
  formatDurationMsForReport,
} from "./statistics-references";

export const EXCEL_HEADER_FILL = "1F4E79";
export const EXCEL_TITLE_FILL = "0F2D4A";
export const EXCEL_META_FILL = "E8EEF4";
export const EXCEL_ALT_ROW_FILL = "F7F9FC";

export type StatisticsExcelCellType =
  | "text"
  | "integer"
  | "money"
  | "percent"
  | "date"
  | "datetime"
  | "duration"
  | "boolean";

export type StatisticsExcelColumn<Row> = {
  header: string;
  width: number;
  type: StatisticsExcelCellType;
  value: (row: Row) => string | number | Date | boolean | null | undefined;
};

export type StatisticsExcelSheet<Row> = {
  name: string;
  columns: readonly StatisticsExcelColumn<Row>[];
  rows: readonly Row[];
};

export type StatisticsExcelWorkbookInput = {
  title: string;
  companyName: string;
  periodFrom: string;
  periodTo: string;
  generatedAt: Date;
  timeZone: string;
  filters: string[];
  limitations: string[];
  definitions: string[];
  sheets: StatisticsExcelSheet<any>[];
};

const FORBIDDEN_HEADER_FRAGMENTS = [
  "Driver ID",
  "Job ID",
  "Trip ID",
  "Vehicle ID",
  "tenantId",
  "Total Valid Duration Ms",
  "Average Duration Ms",
  "Gross Margin Basis Points",
  "Job Charges Cents",
  "Response Limitations",
  "Row Limitations",
];

export function assertManagementExcelHeaders(
  headers: readonly string[],
): void {
  for (const header of headers) {
    for (const fragment of FORBIDDEN_HEADER_FRAGMENTS) {
      if (header.includes(fragment)) {
        throw new Error(`Internal column leaked into Excel: ${header}`);
      }
    }
  }
}

export async function buildStatisticsExcelWorkbook(
  input: StatisticsExcelWorkbookInput,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OpsFlow";
  workbook.created = input.generatedAt;
  workbook.modified = input.generatedAt;
  const sheetNames = createExcelWorksheetNameAllocator();

  for (const sheet of input.sheets) {
    assertManagementExcelHeaders(sheet.columns.map((column) => column.header));
    addDataSheet(workbook, input, sheet, sheetNames);
  }
  addNotesSheet(workbook, input, sheetNames);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function buildStatisticsExcelFilename(
  report: string,
  from: string,
  to: string,
): string {
  const safe = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "unknown-date";
  const label = report.replaceAll(" ", "-");
  if (from.slice(0, 7) === to.slice(0, 7) && from.endsWith("-01")) {
    const monthEnd = new Date(`${to}T00:00:00Z`);
    const last = new Date(Date.UTC(monthEnd.getUTCFullYear(), monthEnd.getUTCMonth() + 1, 0));
    const lastIso = last.toISOString().slice(0, 10);
    if (to === lastIso) {
      return `OpsFlow-${label}-${from.slice(0, 7)}.xlsx`;
    }
  }
  return `OpsFlow-${label}-${safe(from)}-to-${safe(to)}.xlsx`;
}

function addDataSheet<Row>(
  workbook: ExcelJS.Workbook,
  input: StatisticsExcelWorkbookInput,
  sheet: StatisticsExcelSheet<Row>,
  sheetNames: ExcelWorksheetNameAllocator,
): void {
  const worksheet = workbook.addWorksheet(sheetNames.allocate(sheet.name), {
    views: [{ state: "frozen", ySplit: 7, activeCell: "A8" }],
  });
  worksheet.addRow([input.title]);
  worksheet.mergeCells(1, 1, 1, Math.max(sheet.columns.length, 1));
  const titleCell = worksheet.getCell("A1");
  titleCell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: `FF${EXCEL_TITLE_FILL}` },
  };

  const meta = [
    ["Company", input.companyName],
    ["Reporting period", `${input.periodFrom} to ${input.periodTo}`],
    ["Generated at", input.generatedAt.toISOString()],
    ["Timezone", input.timeZone],
    [
      "Applied filters",
      input.filters.length > 0 ? input.filters.join("; ") : "None",
    ],
  ];
  meta.forEach((pair, index) => {
    const row = worksheet.addRow(pair);
    row.getCell(1).font = { bold: true };
    row.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${EXCEL_META_FILL}` },
    };
    worksheet.mergeCells(index + 2, 2, index + 2, Math.max(sheet.columns.length, 2));
  });

  const headerRow = worksheet.addRow(sheet.columns.map((column) => column.header));
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.alignment = { vertical: "middle", wrapText: true };
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${EXCEL_HEADER_FILL}` },
    };
  });

  sheet.columns.forEach((column, index) => {
    worksheet.getColumn(index + 1).width = column.width;
  });

  for (const [rowIndex, row] of sheet.rows.entries()) {
    const values = sheet.columns.map((column) =>
      excelCellValue(column.type, column.value(row)),
    );
    const excelRow = worksheet.addRow(values);
    excelRow.alignment = { vertical: "middle", wrapText: true };
    if (rowIndex % 2 === 1) {
      excelRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: `FF${EXCEL_ALT_ROW_FILL}` },
        };
      });
    }
    sheet.columns.forEach((column, index) => {
      applyNumberFormat(excelRow.getCell(index + 1), column.type);
      if (
        column.type === "integer" ||
        column.type === "money" ||
        column.type === "percent" ||
        column.type === "duration"
      ) {
        excelRow.getCell(index + 1).alignment = {
          horizontal: "right",
          vertical: "middle",
        };
      }
    });
  }

  const headerRowNumber = 7;
  if (sheet.columns.length > 0) {
    worksheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: {
        row: Math.max(headerRowNumber, worksheet.rowCount),
        column: sheet.columns.length,
      },
    };
  }
}

function addNotesSheet(
  workbook: ExcelJS.Workbook,
  input: StatisticsExcelWorkbookInput,
  sheetNames: ExcelWorksheetNameAllocator,
): void {
  const sheet = workbook.addWorksheet(sheetNames.allocate("Notes"));
  sheet.getColumn(1).width = 92;
  const title = sheet.addRow(["Report notes"]);
  title.font = { bold: true, size: 14 };
  sheet.addRow([`Generated at ${input.generatedAt.toISOString()} (${input.timeZone})`]);
  sheet.addRow([]);
  sheet.addRow(["Definitions"]).font = { bold: true };
  for (const definition of input.definitions) {
    sheet.addRow([definition]).alignment = { wrapText: true };
  }
  sheet.addRow([]);
  sheet.addRow(["Data limitations"]).font = { bold: true };
  const notes = input.limitations.map(statisticsLimitationNote);
  for (const note of notes) {
    sheet.addRow([note]).alignment = { wrapText: true };
  }
}

function excelCellValue(
  type: StatisticsExcelCellType,
  value: string | number | Date | boolean | null | undefined,
): ExcelJS.CellValue {
  if (value == null) return null;
  switch (type) {
    case "money":
      return typeof value === "number" ? centsToMajorUnits(value) : value;
    case "percent":
      return typeof value === "number" ? basisPointsToRatio(value) : value;
    case "duration":
      return typeof value === "number"
        ? durationMsToExcelDayFraction(value)
        : value;
    case "boolean":
      return value === true ? "Yes" : value === false ? "No" : null;
    case "date":
    case "datetime":
      return value instanceof Date ? value : value;
    default:
      return value as ExcelJS.CellValue;
  }
}

function applyNumberFormat(cell: ExcelJS.Cell, type: StatisticsExcelCellType): void {
  if (type === "money") cell.numFmt = "#,##0.00";
  if (type === "percent") cell.numFmt = "0.00%";
  if (type === "date") cell.numFmt = "DD MMM YYYY";
  if (type === "datetime") cell.numFmt = "DD MMM YYYY, HH:MM AM/PM";
  if (type === "duration") cell.numFmt = "[h]:mm:ss";
  if (type === "integer") cell.numFmt = "#,##0";
}

export function durationLabel(durationMs: number | null | undefined): string {
  return formatDurationMsForReport(durationMs) ?? "—";
}

export const STATISTICS_REPORT_DEFINITIONS = [
  "Unique container: a distinct Job Item (canonical cargo/container identity) that has at least one container movement in the period.",
  "Container movement: one verified Trip–Job Item link on a completed, non-cancelled trip whose close time falls in the reporting period. The trip container-number display cache is not counted.",
  "Drivers touched: the number of distinct drivers who performed trips linked to that container. This is not the number of trips.",
  "Job Charges: persisted customer-facing JobCharge snapshots. Quotation totals are not revenue.",
  "Issued invoice value: billed invoices in recognized issued/sent/paid statuses, dated by issued/sent time.",
  "Paid invoice value: paid invoices dated by paid-at.",
  "Driver payout: canonical Trip payout lines for completed trips. Currently SGD.",
  "Gross profit: eligible Job Charges minus eligible trip payout, only when revenue and cost are complete and in the same currency.",
];

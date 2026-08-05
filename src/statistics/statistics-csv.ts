export type StatisticsCsvCell =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined;

export type StatisticsCsvColumn<Row> = {
  header: string;
  value: (row: Row) => StatisticsCsvCell;
};

const DANGEROUS_TEXT_PREFIX = /^[=+\-@\t\r]/;

export function neutralizeSpreadsheetFormula(value: string): string {
  return DANGEROUS_TEXT_PREFIX.test(value) ? `'${value}` : value;
}

export function encodeCsvCell(value: StatisticsCsvCell): string {
  if (value == null) return '""';
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "string"
        ? neutralizeSpreadsheetFormula(value)
        : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function serializeStatisticsCsv<Row>(
  columns: readonly StatisticsCsvColumn<Row>[],
  rows: readonly Row[],
): string {
  const header = columns
    .map((column) => encodeCsvCell(column.header))
    .join(",");
  const body = rows.map((row) =>
    columns.map((column) => encodeCsvCell(column.value(row))).join(","),
  );
  return `\uFEFF${[header, ...body].join("\r\n")}\r\n`;
}

export function joinStatisticsLimitations(
  limitations: readonly string[] | null | undefined,
): string {
  return [...(limitations ?? [])].sort().join(" | ");
}

export function buildStatisticsExportFilename(
  view: "drivers" | "finance" | "exceptions",
  from: string,
  to: string,
): string {
  const safeDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "unknown-date";
  return `opsflow-statistics-${view}-${safeDate(from)}-to-${safeDate(to)}.csv`;
}

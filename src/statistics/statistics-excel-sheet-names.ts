export const EXCEL_WORKSHEET_NAME_MAX = 31;
export const EXCEL_WORKSHEET_NAME_FALLBACK = "Sheet";

const FORBIDDEN_EXCEL_SHEET_CHARS = /[\\/?*\[\]:]/g;

export type ExcelWorksheetNameAllocator = {
  allocate(requested: string): string;
};

export function sanitizeExcelWorksheetName(requested: string): string {
  const cleaned = String(requested ?? "")
    .replace(FORBIDDEN_EXCEL_SHEET_CHARS, " ")
    .replace(/\s+/g, " ")
    .replace(/^'+|'+$/g, "")
    .trim();
  const base = cleaned.length > 0 ? cleaned : EXCEL_WORKSHEET_NAME_FALLBACK;
  return truncateExcelWorksheetName(base, EXCEL_WORKSHEET_NAME_MAX);
}

export function createExcelWorksheetNameAllocator(): ExcelWorksheetNameAllocator {
  const used = new Set<string>();

  function isUsed(name: string): boolean {
    return used.has(name.toLowerCase());
  }

  function reserve(name: string): string {
    used.add(name.toLowerCase());
    return name;
  }

  function allocate(requested: string): string {
    const sanitized = sanitizeExcelWorksheetName(requested);
    if (!isUsed(sanitized)) {
      return reserve(sanitized);
    }
    for (let n = 2; n < 10_000; n += 1) {
      const suffix = ` (${n})`;
      const maxBase = Math.max(1, EXCEL_WORKSHEET_NAME_MAX - suffix.length);
      const candidate = `${truncateExcelWorksheetName(sanitized, maxBase)}${suffix}`;
      if (!isUsed(candidate)) {
        return reserve(candidate);
      }
    }
    throw new Error("Unable to allocate a unique Excel worksheet name");
  }

  return { allocate };
}

function truncateExcelWorksheetName(value: string, max: number): string {
  if (max < 1) {
    return "S";
  }
  if (value.length <= max) {
    return value;
  }
  const truncated = value.slice(0, max).replace(/\s+$/g, "");
  if (truncated.length > 0) {
    return truncated;
  }
  return EXCEL_WORKSHEET_NAME_FALLBACK.slice(0, max) || "S";
}

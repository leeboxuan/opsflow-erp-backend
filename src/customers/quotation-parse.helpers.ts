/**
 * Deterministic extraction of Annex A/B style rows from a controlled quotation XLSX.
 * Looks for a sheet whose name contains "annex" (case-insensitive) or falls back to first sheet.
 * Rows: column A = code/label, column B = description (optional), column C = unit, column D = rate (SGD).
 */

export type ParsedQuotationRateLineInput = {
  section?: string | null;
  code: string;
  label: string;
  description?: string | null;
  unit?: string | null;
  rateCents: number;
  containerSize?: string | null;
  tripMode?: string | null;
  areaScope?: string | null;
  sortOrder: number;
  sourceType: string;
};

function parseMoneyToCents(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && !Number.isNaN(raw)) {
    return Math.round(raw * 100);
  }
  const s = String(raw).trim();
  if (!s) return null;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

export function parseQuotationRateLinesFromXlsxBuffer(
  buffer: Buffer,
): ParsedQuotationRateLineInput[] {
  let XLSX: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    XLSX = require("xlsx");
  } catch {
    return [];
  }

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName =
    workbook.SheetNames.find((n: string) =>
      String(n).toLowerCase().includes("annex"),
    ) ?? workbook.SheetNames[0];

  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });

  const out: ParsedQuotationRateLineInput[] = [];
  let sortOrder = 0;
  let currentSection: string | null = null;

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const a = row[0] != null ? String(row[0]).trim() : "";
    const b = row[1] != null ? String(row[1]).trim() : "";
    const c = row[2] != null ? String(row[2]).trim() : "";
    const d = row[3];

    if (!a && !b && !c && (d == null || String(d).trim() === "")) continue;

    if (/^annex\s+[ab]/i.test(a) || /^section\b/i.test(a)) {
      currentSection = a;
      continue;
    }

    const rateCents = parseMoneyToCents(d);
    if (rateCents == null || rateCents < 0) continue;

    const code = a || `LINE_${sortOrder + 1}`;
    const label = a || b || code;
    const description = b && b !== label ? b : null;
    const unit = c || null;

    out.push({
      section: currentSection,
      code,
      label,
      description,
      unit,
      rateCents,
      sortOrder: sortOrder++,
      sourceType: "PARSER_ANNEX",
    });
  }

  return out;
}

export function buildPlaceholderRateLinesFromPdf(): ParsedQuotationRateLineInput[] {
  // PDF parsing not implemented; ops can still attach file and add lines manually later.
  return [];
}

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

type AnnexContext = {
  annex: string | null;
  section: string | null;
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

function updateAnnexContext(text: string, context: AnnexContext): AnnexContext {
  let annex = context.annex;
  let section = context.section;

  const annexMatch = text.match(/\bannex\s*([ab])\b/i);
  if (annexMatch) {
    annex = `ANNEX ${annexMatch[1].toUpperCase()}`;
    section = null;
  }

  const sectionMatch =
    text.match(/\bsection\s*([a-z])\b/i) ||
    text.match(/^([a-z])\s*[\.\):-]\s+/i);
  if (sectionMatch) {
    section = sectionMatch[1].toUpperCase();
  }

  return { annex, section };
}

function sectionFromContext(context: AnnexContext): string | null {
  if (context.annex && context.section) {
    return `${context.annex} ${context.section}`;
  }
  return context.annex;
}

function parseRateLineFromDocxText(
  line: string,
  context: AnnexContext,
  sortOrder: number,
): ParsedQuotationRateLineInput | null {
  const normalized = line.replace(/\s+/g, " ").trim();
  const amountMatch = normalized.match(
    /(-?\$?\d[\d,]*\.\d{1,2}|-?\$?\d{2,}(?:,\d{3})*(?:\.\d{1,2})?)\s*$/,
  );
  if (!amountMatch) return null;
  const rateCents = parseMoneyToCents(amountMatch[1]);
  if (rateCents == null || rateCents < 0) return null;

  const descriptor = normalized.slice(0, amountMatch.index).trim();
  if (!descriptor) return null;

  const descriptorParts = descriptor.split(/\s{2,}|\t+/).filter(Boolean);
  const combined = descriptorParts.join(" ").trim();
  if (!combined) return null;

  const codeCandidate = combined.split(" ")[0] ?? "";
  const codeMatch = codeCandidate.match(/^([A-Z]?\d+(?:\.\d+)*[A-Z-]*)$/i);
  if (!codeMatch) return null;
  const code = codeMatch?.[1] ?? `DOCX_LINE_${sortOrder + 1}`;
  const label = combined.slice(codeCandidate.length).trim() || code;

  const tokens = label.split(" ").filter(Boolean);
  const unitCandidate = tokens[tokens.length - 1] ?? "";
  let unit: string | null = null;
  if (/^(ea|each|set|job|trip|container|20ft|40ft|hrs?|days?)$/i.test(unitCandidate)) {
    unit = unitCandidate;
  }

  return {
    section: sectionFromContext(context),
    code,
    label,
    description: null,
    unit,
    rateCents,
    sortOrder,
    sourceType: "PARSER_ANNEX_DOCX",
  };
}

function buildRateLineFromDocxSequence(
  codeLine: string,
  labelLine: string,
  unitLine: string | null,
  amountLine: string,
  context: AnnexContext,
  sortOrder: number,
): ParsedQuotationRateLineInput | null {
  const codeMatch = codeLine.match(/^([A-Z]?\d+(?:\.\d+)*[A-Z-]*)$/i);
  if (!codeMatch) return null;
  const rateCents = parseMoneyToCents(amountLine);
  if (rateCents == null || rateCents < 0) return null;

  const normalizedLabel = labelLine.replace(/\s+/g, " ").trim();
  if (!normalizedLabel) return null;

  const normalizedUnit = unitLine?.replace(/\s+/g, " ").trim() || null;
  const unit =
    normalizedUnit &&
    /^(ea|each|set|job|trip|container|20ft|40ft|hrs?|days?)$/i.test(
      normalizedUnit,
    )
      ? normalizedUnit
      : null;

  return {
    section: sectionFromContext(context),
    code: codeMatch[1],
    label: normalizedLabel,
    description: null,
    unit,
    rateCents,
    sortOrder,
    sourceType: "PARSER_ANNEX_DOCX",
  };
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

export async function parseQuotationRateLinesFromDocxBuffer(
  buffer: Buffer,
): Promise<ParsedQuotationRateLineInput[]> {
  let mammoth: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mammoth = require("mammoth");
  } catch {
    return [];
  }

  let rawText = "";
  try {
    const result = await mammoth.extractRawText({ buffer });
    rawText = String(result?.value ?? "");
  } catch {
    return [];
  }
  if (!rawText.trim()) return [];

  const out: ParsedQuotationRateLineInput[] = [];
  let sortOrder = 0;
  let context: AnnexContext = { annex: null, section: null };

  const lines = rawText
    .split(/\r?\n/)
    .map((line: string) => line.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    context = updateAnnexContext(line, context);

    if (/^(item|description|unit|rate)$/i.test(line)) {
      continue;
    }

    const parsed = parseRateLineFromDocxText(line, context, sortOrder);
    if (parsed) {
      out.push(parsed);
      sortOrder += 1;
      continue;
    }

    if (/^[A-Z]?\d+(?:\.\d+)*[A-Z-]*$/i.test(line) && i + 2 < lines.length) {
      const labelLine = lines[i + 1];
      let amountIdx = -1;
      for (let j = i + 2; j <= Math.min(i + 4, lines.length - 1); j++) {
        const cents = parseMoneyToCents(lines[j]);
        if (cents != null && cents >= 0) {
          amountIdx = j;
          break;
        }
      }
      if (amountIdx > 0) {
        const unitLine = amountIdx - 1 > i + 1 ? lines[amountIdx - 1] : null;
        const seqLine = buildRateLineFromDocxSequence(
          line,
          labelLine,
          unitLine,
          lines[amountIdx],
          context,
          sortOrder,
        );
        if (seqLine) {
          out.push(seqLine);
          sortOrder += 1;
          i = amountIdx;
        }
      }
    }
  }

  return out;
}

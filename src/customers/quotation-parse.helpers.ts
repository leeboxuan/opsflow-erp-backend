/**
 * Multi-annex quotation extraction for mixed table shapes.
 * Supports controlled Excel master sheets and free-form Annex A/B quotation layouts.
 */

export type ParsedQuotationRateLineInput = {
  annex?: string | null;
  sectionCode?: string | null;
  itemNo?: string | null;
  section?: string | null;
  code: string;
  label: string;
  description?: string | null;
  category?: string | null;
  unit?: string | null;
  rateCents: number | null;
  requiresManualAmount?: boolean;
  rawRateText?: string | null;
  containerSize?: string | null;
  tripMode?: string | null;
  areaScope?: string | null;
  notes?: string | null;
  isSelectableForJob?: boolean;
  isSelectableForTripEarning?: boolean;
  sortOrder: number;
  sourceType: string;
};

type ParsedQuotationNormalizedRow = {
  annex: string | null;
  sectionCode: string | null;
  itemNo: string | null;
  section: string | null;
  code: string;
  label: string;
  description: string | null;
  unit: string | null;
  variants: Array<{ label: string; amountCents: number | null; currency: string }>;
  notes: string | null;
  requiresManualAmount: boolean;
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

function parseRateCell(
  raw: unknown,
): { rateCents: number | null; requiresManualAmount: boolean; rawRateText: string | null } {
  if (raw == null) {
    return { rateCents: null, requiresManualAmount: false, rawRateText: null };
  }
  if (typeof raw === "number" && !Number.isNaN(raw)) {
    return {
      rateCents: Math.round(raw * 100),
      requiresManualAmount: false,
      rawRateText: null,
    };
  }

  const rawText = String(raw).trim();
  if (!rawText) {
    return { rateCents: null, requiresManualAmount: false, rawRateText: null };
  }

  const moneyLikeMatches =
    rawText.match(/-?\$?\s*\d[\d,]*(?:\.\d{1,2})?/g)?.filter(Boolean) ?? [];
  const hasAmbiguousDelimiter =
    rawText.includes("/") || /\bto\b/i.test(rawText) || /\bor\b/i.test(rawText);
  if (moneyLikeMatches.length >= 2 && hasAmbiguousDelimiter) {
    return {
      rateCents: null,
      requiresManualAmount: true,
      rawRateText: rawText,
    };
  }

  return {
    rateCents: parseMoneyToCents(rawText),
    requiresManualAmount: false,
    rawRateText: null,
  };
}

function parseBooleanCell(value: unknown, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  const s = String(value).trim().toLowerCase();
  if (!s) return defaultValue;
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return defaultValue;
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

function isLikelyNotesLine(text: string): boolean {
  return /^(notes?|remarks?)\b/i.test(text.trim());
}

function extractAmountsWithLabels(
  row: any[],
  headerRow: string[],
): Array<{ label: string; amountCents: number | null; currency: string }> {
  const variants: Array<{ label: string; amountCents: number | null; currency: string }> = [];
  for (let i = 0; i < row.length; i++) {
    const cell = row[i];
    if (cell == null || String(cell).trim() === "") continue;
    const parsed = parseRateCell(cell);
    if (parsed.rateCents == null || parsed.rateCents < 0) continue;
    const rawLabel = String(headerRow[i] ?? "").trim();
    const variantLabel = rawLabel || `VARIANT_${i + 1}`;
    variants.push({ label: variantLabel, amountCents: parsed.rateCents, currency: "SGD" });
  }
  return variants;
}

function parseAnnexLikeRowsFromSheet(rows: any[][]): ParsedQuotationNormalizedRow[] {
  const out: ParsedQuotationNormalizedRow[] = [];
  let context: AnnexContext = { annex: null, section: null };
  let headerRow: string[] = [];
  let inNotesBlock = false;
  let autoLine = 1;

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const cells = row.map((c: any) => String(c ?? "").trim());
    if (cells.every((c) => !c)) continue;

    for (const cell of cells) {
      if (!cell) continue;
      context = updateAnnexContext(cell, context);
    }

    const joined = cells.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!joined) continue;
    if (isLikelyNotesLine(joined)) {
      inNotesBlock = true;
      continue;
    }
    if (inNotesBlock) continue;

    const lowered = cells.map((c) => c.toLowerCase());
    const looksLikeHeader =
      lowered.some((c) => /\b(item|code|description|rate|amount|20ft|40ft|unit)\b/.test(c)) &&
      lowered.filter(Boolean).length >= 2;
    if (looksLikeHeader) {
      headerRow = cells;
      continue;
    }

    const first = cells[0] ?? "";
    const second = cells[1] ?? "";
    const third = cells[2] ?? "";

    const itemNo = /^[a-z]?\d+(?:\.\d+)*[a-z-]*$/i.test(first) ? first : null;
    const code = itemNo ?? `LINE_${autoLine++}`;
    const label = (second || first || code).trim();
    if (!label) continue;
    const description = third || null;

    const variants = extractAmountsWithLabels(row, headerRow);
    const rawTexts = cells.filter(Boolean).join(" | ");
    const backToBack = /\bback[-\s]?to[-\s]?back\b/i.test(rawTexts);
    let requiresManualAmount = variants.length === 0 && backToBack;

    if (variants.length === 0 && !requiresManualAmount) {
      const inlineRate = parseRateCell(rawTexts);
      if (inlineRate.rateCents != null && inlineRate.rateCents >= 0) {
        variants.push({
          label: "RATE",
          amountCents: inlineRate.rateCents,
          currency: "SGD",
        });
      } else if (inlineRate.requiresManualAmount) {
        requiresManualAmount = true;
      }
    }

    if (variants.length === 0 && !requiresManualAmount) continue;

    out.push({
      annex: context.annex,
      sectionCode: context.section,
      itemNo,
      section: sectionFromContext(context),
      code,
      label,
      description,
      unit: null,
      variants,
      notes: backToBack ? "Back-to-Back" : null,
      requiresManualAmount,
    });
  }

  return out;
}

function normalizedRowsToParsedLines(
  rows: ParsedQuotationNormalizedRow[],
): ParsedQuotationRateLineInput[] {
  const out: ParsedQuotationRateLineInput[] = [];
  let sortOrder = 0;
  for (const row of rows) {
    if (row.variants.length > 0) {
      for (const variant of row.variants) {
        const variantLabel = String(variant.label ?? "").trim();
        out.push({
          annex: row.annex,
          sectionCode: row.sectionCode,
          itemNo: row.itemNo,
          section: row.section,
          code:
            variantLabel && variantLabel !== "RATE"
              ? `${row.code}_${variantLabel.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}`
              : row.code,
          label:
            variantLabel && variantLabel !== "RATE"
              ? `${row.label} (${variantLabel})`
              : row.label,
          description: row.description,
          unit: row.unit,
          rateCents: variant.amountCents,
          requiresManualAmount: row.requiresManualAmount,
          rawRateText: null,
          containerSize: variantLabel || null,
          notes: row.notes,
          sortOrder: sortOrder++,
          sourceType: "PARSER_ANNEX_MULTI",
          isSelectableForJob: true,
          isSelectableForTripEarning: false,
        });
      }
      continue;
    }

    out.push({
      annex: row.annex,
      sectionCode: row.sectionCode,
      itemNo: row.itemNo,
      section: row.section,
      code: row.code,
      label: row.label,
      description: row.description,
      unit: row.unit,
      rateCents: null,
      requiresManualAmount: true,
      rawRateText: row.notes,
      notes: row.notes,
      sortOrder: sortOrder++,
      sourceType: "PARSER_ANNEX_MULTI",
      isSelectableForJob: true,
      isSelectableForTripEarning: false,
    });
  }
  return out;
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
    requiresManualAmount: false,
    rawRateText: null,
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
    requiresManualAmount: false,
    rawRateText: null,
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
  const annexSheetNames = workbook.SheetNames.filter((n: string) =>
    String(n).toLowerCase().includes("annex"),
  );
  const sheetNames = annexSheetNames.length > 0 ? annexSheetNames : workbook.SheetNames.slice(0, 1);
  if (!sheetNames.length) return [];
  const out: ParsedQuotationRateLineInput[] = [];
  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
    });
    if (!rows.length) continue;

    const header = (rows[0] ?? []).map((c: any) => String(c ?? "").trim().toLowerCase());
    const idx = (name: string) => header.findIndex((h: string) => h === name);
    const controlledHeaderDetected =
      idx("code") >= 0 &&
      idx("label") >= 0 &&
      (idx("ratecents") >= 0 || idx("rate") >= 0);

    if (controlledHeaderDetected) {
      const idxSection = idx("section");
      const idxCode = idx("code");
      const idxLabel = idx("label");
      const idxDescription = idx("description");
      const idxCategory = idx("category");
      const idxContainerSize = idx("containersize");
      const idxTripMode = idx("tripmode");
      const idxAreaScope = idx("areascope");
      const idxUnit = idx("unit");
      const idxRateCents = idx("ratecents");
      const idxRate = idx("rate");
      const idxNotes = idx("notes");
      const idxSelectableJob = idx("isselectableforjob");
      const idxSelectableTrip = idx("isselectablefortripearning");
      let sortOrder = out.length;

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!Array.isArray(row)) continue;
        const code = String(row[idxCode] ?? "").trim();
        const label = String(row[idxLabel] ?? "").trim() || code;
        if (!code || !label) continue;

        const rawRate = idxRateCents >= 0 ? row[idxRateCents] : row[idxRate];
        const parsedRate =
          idxRateCents >= 0
            ? (() => {
                const rawText = String(rawRate ?? "").trim();
                const moneyLikeMatches =
                  rawText.match(/-?\$?\s*\d[\d,]*(?:\.\d{1,2})?/g)?.filter(Boolean) ?? [];
                const hasAmbiguousDelimiter =
                  rawText.includes("/") || /\bto\b/i.test(rawText) || /\bor\b/i.test(rawText);
                if (moneyLikeMatches.length >= 2 && hasAmbiguousDelimiter) {
                  return { rateCents: null, requiresManualAmount: true, rawRateText: rawText };
                }
                const n = Number(String(rawRate ?? "").replace(/[$,\s]/g, ""));
                return {
                  rateCents: Number.isNaN(n) ? null : Math.round(n),
                  requiresManualAmount: false,
                  rawRateText: null,
                };
              })()
            : parseRateCell(rawRate);

        if (
          (!parsedRate.requiresManualAmount && parsedRate.rateCents == null) ||
          (parsedRate.rateCents != null && parsedRate.rateCents < 0)
        ) {
          continue;
        }

        out.push({
          section: idxSection >= 0 ? String(row[idxSection] ?? "").trim() || null : null,
          code,
          label,
          description:
            idxDescription >= 0 ? String(row[idxDescription] ?? "").trim() || null : null,
          category: idxCategory >= 0 ? String(row[idxCategory] ?? "").trim() || null : null,
          containerSize:
            idxContainerSize >= 0
              ? String(row[idxContainerSize] ?? "").trim() || null
              : null,
          tripMode: idxTripMode >= 0 ? String(row[idxTripMode] ?? "").trim() || null : null,
          areaScope:
            idxAreaScope >= 0 ? String(row[idxAreaScope] ?? "").trim() || null : null,
          unit: idxUnit >= 0 ? String(row[idxUnit] ?? "").trim() || null : null,
          rateCents:
            parsedRate.rateCents == null ? null : Math.round(Number(parsedRate.rateCents)),
          requiresManualAmount: parsedRate.requiresManualAmount,
          rawRateText: parsedRate.rawRateText,
          notes:
            idxNotes >= 0
              ? String(row[idxNotes] ?? "").trim() || parsedRate.rawRateText
              : parsedRate.rawRateText,
          isSelectableForJob:
            idxSelectableJob >= 0 ? parseBooleanCell(row[idxSelectableJob], true) : true,
          isSelectableForTripEarning:
            idxSelectableTrip >= 0
              ? parseBooleanCell(row[idxSelectableTrip], false)
              : false,
          sortOrder: sortOrder++,
          sourceType: "EXCEL_MASTER_CONTROLLED",
        });
      }
      continue;
    }

    const normalized = parseAnnexLikeRowsFromSheet(rows);
    const parsed = normalizedRowsToParsedLines(normalized);
    for (const line of parsed) {
      line.sortOrder = out.length;
      out.push(line);
    }
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

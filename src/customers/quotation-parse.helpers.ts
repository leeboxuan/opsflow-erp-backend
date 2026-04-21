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

export type ParsedQuotationVariant = {
  variantKey: string;
  variantLabel: string;
  rateCents: number | null;
  rawValueText: string | null;
  requiresManualAmount: boolean;
  sortOrder: number;
};

export type ParsedQuotationParentItem = {
  annex: string;
  sectionCode: string;
  lineNo: number;
  code: string;
  label: string;
  groupTitle: string;
  notes: string | null;
  sortOrder: number;
  variants: ParsedQuotationVariant[];
  unit?: string | null;
  description?: string | null;
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

function toVariantKey(label: string): string {
  const s = String(label ?? "").trim().toUpperCase();
  if (/20/.test(s)) return "20FT";
  if (/40/.test(s)) return "40FT";
  if (/NORMAL/.test(s) && /TRAILER/.test(s)) return "NORMAL_TRAILER";
  if (/LOW/.test(s) && /BED/.test(s)) return "LOW_BED";
  if (/WITHIN/.test(s) && /JURONG/.test(s)) return "WITHIN_JURONG";
  if (/OUT/.test(s) && /JURONG/.test(s)) return "OUT_OF_JURONG";
  if (/DEFAULT/.test(s)) return "DEFAULT";
  return s.replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "DEFAULT";
}

function detectAnnex(text: string): { annex: string | null; sectionCode: string | null } {
  const m = text.match(/\bANNEX\s*([A-C])\b/i);
  if (!m) return { annex: null, sectionCode: null };
  const sectionCode = m[1].toUpperCase();
  return { annex: `ANNEX ${sectionCode}`, sectionCode };
}

function isGroupTitleRow(cells: string[]): boolean {
  const nonEmpty = cells.filter(Boolean);
  if (!nonEmpty.length) return false;
  if (nonEmpty.length > 2) return false;
  const joined = nonEmpty.join(" ").trim();
  if (!joined) return false;
  if (/^ANNEX\b/i.test(joined)) return false;
  if (/^\d+/.test(joined)) return false;
  return /RATES|CHARGES|TRUCKING|TRANSPORTATION|LCL/i.test(joined);
}

function isVariantHeaderRow(cells: string[]): boolean {
  const joined = cells.filter(Boolean).join(" ").toLowerCase();
  return (
    /per\s*20/.test(joined) ||
    /per\s*40/.test(joined) ||
    /normal\s*trailer/.test(joined) ||
    /low\s*bed/.test(joined)
  );
}

function parseCellBasedVariants(raw: string): ParsedQuotationVariant[] {
  const out: ParsedQuotationVariant[] = [];
  const regex = /(\$?\s*\d[\d,]*(?:\.\d{1,2})?)\s*\(([^)]+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw))) {
    const amount = parseMoneyToCents(match[1]);
    const label = String(match[2] ?? "").trim();
    if (!label) continue;
    out.push({
      variantKey: toVariantKey(label),
      variantLabel: label,
      rateCents: amount,
      rawValueText: raw,
      requiresManualAmount: amount == null,
      sortOrder: out.length,
    });
  }
  return out;
}

export function parseQuotationMatrixFromXlsxBuffer(buffer: Buffer): ParsedQuotationParentItem[] {
  let XLSX: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    XLSX = require("xlsx");
  } catch {
    return [];
  }
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const out: ParsedQuotationParentItem[] = [];
  let sortOrder = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows.length) continue;

    let annex = "";
    let sectionCode = "";
    let groupTitle = "";
    let variantCols: Array<{ col: number; label: string }> = [];

    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const cells = row.map((c: any) => String(c ?? "").trim());
      if (cells.every((c) => !c)) continue;
      const joined = cells.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      if (!joined) continue;
      if (isLikelyNotesLine(joined)) continue;

      const annexHit = detectAnnex(joined);
      if (annexHit.annex) {
        annex = annexHit.annex;
        sectionCode = annexHit.sectionCode ?? sectionCode;
        groupTitle = "";
        variantCols = [];
        continue;
      }
      const sectionHit = joined.match(/\bSECTION\s*([A-Z])\b/i);
      if (sectionHit) {
        sectionCode = sectionHit[1].toUpperCase();
        continue;
      }

      if (isGroupTitleRow(cells)) {
        groupTitle = joined;
        continue;
      }

      if (isVariantHeaderRow(cells)) {
        variantCols = [];
        cells.forEach((c, idx) => {
          if (!c) return;
          const key = toVariantKey(c);
          if (["20FT", "40FT", "NORMAL_TRAILER", "LOW_BED"].includes(key)) {
            variantCols.push({ col: idx, label: c });
          }
        });
        continue;
      }

      const c0 = String(cells[0] ?? "").trim();
      const numbered = c0.match(/^(\d+)$/);
      const alphaNum = c0.match(/^([A-Z])(\d+)$/i);
      if (!numbered && !alphaNum) continue;
      const lineNo = Number(numbered?.[1] ?? alphaNum?.[2]);
      const codeSection = ((alphaNum?.[1] ?? sectionCode) || "X").toUpperCase();
      const code = alphaNum ? c0.toUpperCase() : `${codeSection}_${lineNo}`;
      const label = alphaNum ? code : String(cells[1] ?? "").trim();
      const description = alphaNum ? String(cells[1] ?? "").trim() || null : null;
      if (!label) continue;

      const variants: ParsedQuotationVariant[] = [];
      if (variantCols.length > 0) {
        for (const v of variantCols) {
          const raw = String(cells[v.col] ?? "").trim();
          if (!raw) continue;
          const cents = parseMoneyToCents(raw);
          variants.push({
            variantKey: toVariantKey(v.label),
            variantLabel: v.label,
            rateCents: cents,
            rawValueText: cents == null ? raw : null,
            requiresManualAmount: cents == null,
            sortOrder: variants.length,
          });
        }
      }

      const trailingStart = alphaNum ? 3 : 2;
      const trailingText = cells.slice(trailingStart).filter(Boolean).join(" ").trim();
      if (variants.length === 0 && trailingText) {
        const cellBased = parseCellBasedVariants(trailingText);
        if (cellBased.length > 0) {
          cellBased.forEach((v) => variants.push({ ...v, sortOrder: variants.length }));
        } else {
          const cents = parseMoneyToCents(trailingText);
          const onlyMoney = /^[$\s\d,.\-]+$/.test(trailingText);
          variants.push({
            variantKey: "DEFAULT",
            variantLabel: "Default",
            rateCents: onlyMoney ? cents : null,
            rawValueText: onlyMoney ? null : trailingText,
            requiresManualAmount: !onlyMoney || cents == null,
            sortOrder: 0,
          });
        }
      }

      if (!variants.length) continue;
      out.push({
        annex: annex || "ANNEX UNKNOWN",
        sectionCode: codeSection,
        lineNo,
        code,
        label,
        groupTitle: groupTitle || "UNSPECIFIED",
        notes: null,
        sortOrder: sortOrder++,
        variants,
        unit: String(cells[2] ?? "").trim() || null,
        description,
      });
    }
  }

  return out;
}

function matrixRowsToParsedLines(rows: ParsedQuotationParentItem[]): ParsedQuotationRateLineInput[] {
  const out: ParsedQuotationRateLineInput[] = [];
  let sortOrder = 0;
  for (const row of rows) {
    for (const variant of row.variants) {
      out.push({
        annex: row.annex,
        sectionCode: row.sectionCode,
        itemNo: String(row.lineNo),
        section: `${row.annex} ${row.sectionCode}`,
        code:
          row.variants.length === 1 && variant.variantKey === "DEFAULT"
            ? row.code
            : `${row.code}_${variant.variantKey}`,
        label:
          row.variants.length === 1 && variant.variantKey === "DEFAULT"
            ? row.label
            : `${row.label} (${variant.variantLabel})`,
        description: row.description ?? row.groupTitle,
        category: row.groupTitle,
        unit: row.unit ?? null,
        rateCents: variant.rateCents,
        requiresManualAmount: variant.requiresManualAmount,
        rawRateText: variant.rawValueText,
        containerSize: variant.variantKey,
        notes: row.notes ?? variant.rawValueText,
        sortOrder: sortOrder++,
        sourceType: "PARSER_ANNEX_MATRIX",
        isSelectableForJob: true,
        isSelectableForTripEarning: false,
      });
    }
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

    const matrix = parseQuotationMatrixFromXlsxBuffer(buffer);
    const parsed = matrixRowsToParsedLines(matrix);
    for (const line of parsed) {
      line.sortOrder = out.length;
      out.push(line);
    }
    break;
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

/**
 * Multi-annex quotation extraction for mixed table shapes.
 * Supports controlled Excel master sheets and free-form Annex A/B quotation layouts.
 */

export type ParsedQuotationRateLineInput = {
  annex?: string | null;
  sectionCode?: string | null;
  groupTitle?: string | null;
  sectionDisplay?: string | null;
  baseCode?: string | null;
  baseLabel?: string | null;
  variantType?: string | null;
  variantLabel?: string | null;
  /** Equipment discriminator when variantType is EQUIPMENT */
  equipmentType?: string | null;
  itemNo?: string | null;
  /** Supplementary pricing rule text (kept separate from baseLabel) */
  additionalRuleText?: string | null;
  /** Structured parser payload persisted on dataset rows */
  metadataJson?: Record<string, unknown> | null;
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

export type QuotationReconciliationSummary = {
  counts: Record<string, number>;
  expected: Record<string, number>;
  isMatch: boolean;
  warnings: string[];
};

/** One numbered business item (used for reconciliation counts, not variant expansion) */
export type ParsedQuotationBusinessItem = {
  annex: string;
  sectionCode: string;
  groupTitle: string;
  itemNo: string;
  baseCode: string;
  baseLabel: string;
};

/** One semantic pricing rule (before legacy flat mapping if needed) */
export type QuotationSemanticRow = {
  annex: string;
  sectionCode: string;
  groupTitle: string;
  baseCode: string;
  baseLabel: string;
  itemNo: string;
  variantType: string;
  variantLabel: string;
  containerSize: string | null;
  equipmentType: string | null;
  areaScope: string | null;
  rateCents: number | null;
  rawValueText: string | null;
  additionalRuleText: string | null;
  requiresManualAmount: boolean;
  notes: string | null;
  sortOrder: number;
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
  if (/^-?\d[\d,]*(?:\.\d{1,2})?$/.test(s.replace(/,/g, ""))) {
    const n0 = Number(s.replace(/,/g, ""));
    if (!Number.isNaN(n0)) return Math.round(n0 * 100);
  }
  const moneyish = s.match(/-?\$?\s*\d[\d,]*(?:\.\d{1,2})?/g) ?? [];
  const token = (moneyish.length ? moneyish[moneyish.length - 1] : s).trim();
  let cleaned = token.replace(/[$,\s]/g, "");
  // Also allow plain decimal amounts like "550.00" (common in matrix cells)
  if (!/^-?\d/.test(cleaned)) {
    const plain = s.match(/-?\d[\d,]*(?:\.\d{1,2})?/g);
    if (!plain?.length) return null;
    cleaned = plain[plain.length - 1].replace(/,/g, "");
  }
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

/** Text after the last money-like token (e.g. "$150.00 per Unit" -> "per Unit"). */
function trailingUnitTextAfterLastMoney(line: string): string | null {
  const s = String(line).trim();
  const moneyRe = /-?\$?\s*\d[\d,]*(?:\.\d{1,2})?/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = moneyRe.exec(s))) last = m;
  if (!last) return null;
  const tail = s.slice(last.index + last[0].length).trim().replace(/\s+/g, " ");
  return tail || null;
}

/** Unit phrases we persist in `notes` whenever a numeric rate is parsed from the same blob. */
const UNIT_DESCRIPTOR_IN_NOTES_RE =
  /\b(per\s+trip|per\s+unit|per\s+calendar\s+day)\b/i;

/**
 * Extracts unit-descriptor text (per trip / per Unit / per Calendar Day) from a value blob
 * after the last money token, or from non-money lines that only carry those phrases.
 */
function unitDescriptorNotesFromCombinedValue(combinedText: string): string | null {
  const s = String(combinedText ?? "").trim();
  if (!s) return null;
  const flat = s
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const tail = trailingUnitTextAfterLastMoney(flat);
  if (tail && UNIT_DESCRIPTOR_IN_NOTES_RE.test(tail)) return tail;

  const unitLines = s
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/\$/.test(l) && UNIT_DESCRIPTOR_IN_NOTES_RE.test(l));
  if (unitLines.length) return unitLines.join(" ").replace(/\s+/g, " ").trim();

  return null;
}

/** When exactly one priced semantic row exists, attach missing unit-descriptor notes from the full value text. */
function attachUnitDescriptorNotesForConsistentPricing(
  rows: QuotationSemanticRow[],
  combinedText: string,
): void {
  const u = unitDescriptorNotesFromCombinedValue(combinedText);
  if (!u) return;
  const priced = rows.filter((r) => r.rateCents != null);
  if (priced.length !== 1) return;
  const r = priced[0];
  if (!r.notes) {
    r.notes = u;
    return;
  }
  const rn = r.notes.toLowerCase();
  const un = u.toLowerCase();
  if (un === rn) return;
  if (un.includes(rn)) {
    r.notes = u;
    return;
  }
  if (rn.includes(un)) return;
  r.notes = `${r.notes} ${u}`.trim();
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

  const sanitizedLines = rawText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^additional\b/i.test(l));
  const sanitizedFlat = sanitizedLines.join(" ").replace(/\s+/g, " ").trim();

  const moneyLikeMatches =
    sanitizedFlat.match(/-?\$?\s*\d[\d,]*(?:\.\d{1,2})?/g)?.filter(Boolean) ?? [];
  const hasAmbiguousDelimiter =
    sanitizedFlat.includes("/") || /\bto\b/i.test(sanitizedFlat) || /\bor\b/i.test(sanitizedFlat);
  if (moneyLikeMatches.length >= 2 && hasAmbiguousDelimiter) {
    return {
      rateCents: null,
      requiresManualAmount: true,
      rawRateText: rawText,
    };
  }

  return {
    rateCents:
      moneyLikeMatches.length >= 2 && hasAmbiguousDelimiter ? null : parseMoneyToCents(sanitizedFlat),
    requiresManualAmount: moneyLikeMatches.length >= 2 && hasAmbiguousDelimiter,
    rawRateText: moneyLikeMatches.length >= 2 && hasAmbiguousDelimiter ? rawText : null,
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

type VariantHeader = { col: number; label: string; kind: "CONTAINER" | "EQUIPMENT" | "AREA" | "OTHER" };

type BusinessItemDraft = {
  annex: string;
  sectionCode: string;
  groupTitle: string;
  itemNo: string;
  baseCode: string;
  baseLabel: string;
  /** First row cells after item start (for column variants) */
  firstRowCells: string[];
  /** Continuation text lines (wrapped rows) */
  continuationTexts: string[];
  additionalRuleText: string | null;
};

function normalizeRowCells(row: any[]): string[] {
  return row.map((c: any) => {
    if (c == null) return "";
    if (typeof c === "number" && Number.isFinite(c) && Math.floor(c) === c) {
      return String(Math.trunc(c));
    }
    return String(c).replace(/\r\n/g, "\n").trim();
  });
}

function rowJoined(cells: string[]): string {
  // Preserve intentional newlines inside cells (wrapped annex rows), while still
  // producing a stable single-string representation for simple row detection.
  return cells
    .filter(Boolean)
    .map((c) => String(c).replace(/\r\n/g, "\n").trim())
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function detectAnnexLetter(joined: string): string | null {
  const m = joined.match(/^\s*annex\s*([A-Z])\b/i);
  return m ? m[1].toUpperCase() : null;
}

function isSectionContextRow(cells: string[]): { section: string; title: string } | null {
  const c0 = String(cells[0] ?? "").trim();
  const c1 = String(cells[1] ?? "").trim();

  // Common matrix layout: "A" | "CONTAINER TRUCKING ..."
  if (/^[A-Z]$/.test(c0)) {
    if (!c1 || c1.length < 6) return null;
    if (/^\d+$/.test(c0)) return null;
    return { section: c0, title: c1.trim() };
  }

  // Alternate layout: "B OTHER CHARGES" in first cell
  const merged = c0.replace(/\s+/g, " ").trim();
  const m = merged.match(/^([A-Z])\s+(.{6,})$/);
  if (!m) return null;
  return { section: m[1], title: m[2].trim() };
}

function isStandaloneGroupHeader(joined: string): boolean {
  if (/^ANNEX\b/i.test(joined)) return false;
  if (/^\d+\b/.test(joined)) return false;
  return /\b(RATES|CHARGES|TRUCKING|TRANSPORTATION|LCL)\b/i.test(joined);
}

function classifyVariantHeaderLabel(label: string): VariantHeader["kind"] {
  const s = label.toLowerCase();
  if (/per\s*20|20\s*ft|20'/.test(s)) return "CONTAINER";
  if (/per\s*40|40\s*ft|40'/.test(s)) return "CONTAINER";
  if (/normal\s*trailer/.test(s) || /low\s*bed/.test(s)) return "EQUIPMENT";
  if (/west\s*area|out\s+of\s+jurong|within\s+jurong|jurong/.test(s)) return "AREA";
  return "OTHER";
}

function parseVariantHeadersFromRow(cells: string[]): VariantHeader[] {
  const headers: VariantHeader[] = [];
  cells.forEach((c, idx) => {
    if (idx < 2) return;
    if (!c) return;
    if (/^(item|no|description|uom|unit|rate|amount)$/i.test(c)) return;
    const kind = classifyVariantHeaderLabel(c);
    if (kind === "OTHER") return;
    headers.push({ col: idx, label: c, kind });
  });
  return headers;
}

function isNumberedBusinessRow(cells: string[]): boolean {
  return /^\d+$/.test(String(cells[0] ?? "").trim());
}

function extractBaseLabelFromNumberedRow(cells: string[]): string {
  const c1 = String(cells[1] ?? "").trim();
  if (c1) return c1;
  return String(cells[2] ?? "").trim();
}

function extractAdditionalRuleFromText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (/^additional\b/i.test(t) && /\b(per|thereafter)\b/i.test(t)) return t;
  return null;
}

function stripAdditionalRuleFromLabel(label: string, rule: string | null): string {
  if (!rule) return label;
  return label.replace(rule, "").replace(/\s+/g, " ").trim();
}

function emitSemanticRow(input: {
  annex: string;
  sectionCode: string;
  groupTitle: string;
  baseCode: string;
  baseLabel: string;
  itemNo: string;
  variantType: string;
  variantLabel: string;
  containerSize: string | null;
  equipmentType: string | null;
  areaScope: string | null;
  rateCents: number | null;
  rawValueText: string | null;
  additionalRuleText: string | null;
  requiresManualAmount: boolean;
  notes: string | null;
  sortOrder: number;
}): QuotationSemanticRow {
  return {
    annex: input.annex,
    sectionCode: input.sectionCode,
    groupTitle: input.groupTitle,
    baseCode: input.baseCode,
    baseLabel: input.baseLabel,
    itemNo: input.itemNo,
    variantType: input.variantType,
    variantLabel: input.variantLabel,
    containerSize: input.containerSize,
    equipmentType: input.equipmentType,
    areaScope: input.areaScope,
    rateCents: input.rateCents,
    rawValueText: input.rawValueText,
    additionalRuleText: input.additionalRuleText,
    requiresManualAmount: input.requiresManualAmount,
    notes: input.notes,
    sortOrder: input.sortOrder,
  };
}

function semanticSuffixForRow(r: QuotationSemanticRow): string {
  if (r.variantType === "CONTAINER_SIZE" && r.containerSize) return r.containerSize;
  if (r.variantType === "EQUIPMENT" && r.equipmentType) return r.equipmentType;
  if (r.variantType === "AREA" && r.areaScope) return r.areaScope;
  if (r.variantType === "DEFAULT") return "DEFAULT";
  return r.variantLabel.replace(/[^A-Z0-9]+/gi, "_").toUpperCase();
}

function semanticRowsToParsedLines(rows: QuotationSemanticRow[]): ParsedQuotationRateLineInput[] {
  const out: ParsedQuotationRateLineInput[] = [];
  for (const r of rows) {
    const suffix = semanticSuffixForRow(r);
    const code = suffix === "DEFAULT" ? r.baseCode : `${r.baseCode}_${suffix}`;
    const meta: Record<string, unknown> = {
      annex: r.annex,
      sectionCode: r.sectionCode,
      groupTitle: r.groupTitle,
      baseCode: r.baseCode,
      baseLabel: r.baseLabel,
      variantType: r.variantType,
      variantLabel: r.variantLabel,
      itemNo: r.itemNo,
      containerSize: r.containerSize,
      equipmentType: r.equipmentType,
      areaScope: r.areaScope,
      additionalRuleText: r.additionalRuleText,
      rawValueText: r.rawValueText,
      parserSourceType: "PARSER_ANNEX_MATRIX",
    };
    out.push({
      annex: r.annex,
      sectionCode: r.sectionCode,
      groupTitle: r.groupTitle,
      sectionDisplay: `ANNEX ${r.annex}`,
      baseCode: r.baseCode,
      baseLabel: r.baseLabel,
      variantType: r.variantType,
      variantLabel: r.variantLabel,
      equipmentType: r.equipmentType,
      itemNo: r.itemNo,
      section: `ANNEX ${r.annex}`,
      code,
      label: r.baseLabel,
      description: null,
      category: null,
      unit: null,
      containerSize: r.containerSize,
      tripMode: null,
      areaScope: r.areaScope,
      rateCents: r.rateCents,
      requiresManualAmount: r.requiresManualAmount,
      rawRateText: r.rawValueText,
      notes: r.notes,
      additionalRuleText: r.additionalRuleText,
      sortOrder: r.sortOrder,
      sourceType: "PARSER_ANNEX_MATRIX",
      isSelectableForJob: true,
      isSelectableForTripEarning: false,
      metadataJson: meta,
    });
  }
  return out;
}

function classifyAreaLine(rest: string): { areaScope: string | null; variantLabel: string } {
  const t = rest.toLowerCase();
  if (/expressway\s+escort\s+additional/i.test(rest)) {
    return { areaScope: "ESCORT_EXTRA", variantLabel: "Expressway Escort Additional" };
  }
  if (/west\s*area/.test(t)) return { areaScope: "WEST_AREA", variantLabel: "West Area" };
  if (/within\s+jurong/.test(t)) return { areaScope: "WITHIN_JURONG", variantLabel: "Within Jurong" };
  if (/out\s+of\s+jurong/.test(t)) return { areaScope: "OUT_OF_JURONG", variantLabel: "Out of Jurong" };
  return { areaScope: null, variantLabel: rest.trim() || "Area" };
}

function parseTimebandAreaMoneyLine(line: string): {
  timebandNotes: string | null;
  cents: number | null;
  areaScope: string | null;
  variantLabel: string;
  raw: string;
} | null {
  const raw = line.trim();
  // Example: "Up to 3 Hours    $240.00 (West Area)"
  const m = raw.match(
    /^(.*?)\s+(\$?\s*-?\d[\d,]*(?:\.\d{1,2})?)\s*\(([^)]+)\)\s*$/i,
  );
  if (!m) return null;
  const timebandNotes = m[1].trim() || null;
  const cents = parseMoneyToCents(m[2]);
  const inside = String(m[3] ?? "").trim();
  const { areaScope, variantLabel } = classifyAreaLine(inside);
  if (!areaScope) return null;
  return { timebandNotes, cents, areaScope, variantLabel, raw };
}

function labeledColonSegmentsFromText(text: string): Array<{ left: string; right: string; raw: string }> {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const labelRe =
    "(Normal\\s+Trailer|Low\\s+Bed|West\\s+Area|Out\\s+of\\s+Jurong|Within\\s+Jurong)\\s*:\\s*";
  const re = new RegExp(labelRe, "gi");
  const out: Array<{ left: string; right: string; raw: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const start = m.index;
    const label = m[1];
    const after = t.slice(start + m[0].length);
    const next = after.search(new RegExp(labelRe, "i"));
    const chunk = (next >= 0 ? after.slice(0, next) : after).trim();
    const raw = `${label}: ${chunk}`.trim();
    out.push({ left: label, right: chunk, raw });
  }
  return out;
}

function emitRowsForBusinessItem(
  item: BusinessItemDraft,
  variantHeaders: VariantHeader[],
  sortOrderStart: number,
): QuotationSemanticRow[] {
  const rows: QuotationSemanticRow[] = [];
  let sort = sortOrderStart;

  const allTextBlocks: string[] = [];
  const firstJoined = rowJoined(item.firstRowCells);
  if (firstJoined) allTextBlocks.push(firstJoined);
  for (const t of item.continuationTexts) {
    if (t.trim()) allTextBlocks.push(t.trim());
  }
  const combinedFull = allTextBlocks.join("\n");
  const stripPrefix = (text: string): string => {
    const split = String(text)
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!split.length) return "";

    const no = String(item.itemNo ?? "").trim();
    const label = String(item.baseLabel ?? "").trim();
    const parts = [...split];

    // Matrix layout often puts item no, label, and value in separate cells/lines.
    // Remove leading lines that are only the item number and/or an exact label echo.
    while (parts.length) {
      if (no && new RegExp(`^${no}$`).test(parts[0])) {
        parts.shift();
        continue;
      }
      if (label && parts[0] === label) {
        parts.shift();
        continue;
      }
      break;
    }
    if (!parts.length) return "";

    let head = parts[0];
    if (no && new RegExp(`^${no}\\b`).test(head)) {
      head = head.replace(new RegExp(`^${no}\\b`), "").trim();
    }
    if (label) {
      const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`^${esc}\\b`).test(head)) {
        head = head.replace(new RegExp(`^${esc}\\b`), "").trim();
      }
    }

    const rest = parts.slice(1);
    return [head, ...rest].filter(Boolean).join("\n").trim();
  };
  const combinedText = stripPrefix(combinedFull);

  // Column variants (Pattern A/B depending on header kinds)
  if (variantHeaders.length > 0) {
    for (const h of variantHeaders) {
      const raw = String(item.firstRowCells[h.col] ?? "").trim();
      if (!raw) continue;
      const cents = parseMoneyToCents(raw);
      if (h.kind === "CONTAINER") {
        const cs = /40/.test(h.label) ? "40FT" : "20FT";
        rows.push(
          emitSemanticRow({
            annex: item.annex,
            sectionCode: item.sectionCode,
            groupTitle: item.groupTitle,
            baseCode: item.baseCode,
            baseLabel: item.baseLabel,
            itemNo: item.itemNo,
            variantType: "CONTAINER_SIZE",
            variantLabel: cs === "40FT" ? "40FT" : "20FT",
            containerSize: cs,
            equipmentType: null,
            areaScope: null,
            rateCents: cents,
            rawValueText: cents == null ? raw : null,
            additionalRuleText: item.additionalRuleText,
            requiresManualAmount: cents == null,
            notes: unitDescriptorNotesFromCombinedValue(raw),
            sortOrder: sort++,
          }),
        );
      } else if (h.kind === "EQUIPMENT") {
        const isLow = /low\s*bed/i.test(h.label);
        rows.push(
          emitSemanticRow({
            annex: item.annex,
            sectionCode: item.sectionCode,
            groupTitle: item.groupTitle,
            baseCode: item.baseCode,
            baseLabel: item.baseLabel,
            itemNo: item.itemNo,
            variantType: "EQUIPMENT",
            variantLabel: isLow ? "Low Bed" : "Normal Trailer",
            containerSize: null,
            equipmentType: isLow ? "LOW_BED" : "NORMAL_TRAILER",
            areaScope: null,
            rateCents: cents,
            rawValueText: cents == null ? raw : null,
            additionalRuleText: item.additionalRuleText,
            requiresManualAmount: cents == null,
            notes: unitDescriptorNotesFromCombinedValue(raw),
            sortOrder: sort++,
          }),
        );
      } else if (h.kind === "AREA") {
        const { areaScope, variantLabel } = classifyAreaLine(h.label);
        rows.push(
          emitSemanticRow({
            annex: item.annex,
            sectionCode: item.sectionCode,
            groupTitle: item.groupTitle,
            baseCode: item.baseCode,
            baseLabel: item.baseLabel,
            itemNo: item.itemNo,
            variantType: "AREA",
            variantLabel,
            containerSize: null,
            equipmentType: null,
            areaScope,
            rateCents: cents,
            rawValueText: cents == null ? raw : null,
            additionalRuleText: item.additionalRuleText,
            requiresManualAmount: cents == null,
            notes: unitDescriptorNotesFromCombinedValue(raw),
            sortOrder: sort++,
          }),
        );
      }
    }
    attachUnitDescriptorNotesForConsistentPricing(rows, combinedText);
    return rows;
  }

  // Multiline / cell patterns
  const lines = combinedText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const used = new Set<number>();

  const pushDefaultTextRule = (raw: string) => {
    rows.push(
      emitSemanticRow({
        annex: item.annex,
        sectionCode: item.sectionCode,
        groupTitle: item.groupTitle,
        baseCode: item.baseCode,
        baseLabel: item.baseLabel,
        itemNo: item.itemNo,
        variantType: "DEFAULT",
        variantLabel: "Default",
        containerSize: null,
        equipmentType: null,
        areaScope: null,
        rateCents: null,
        rawValueText: raw,
        additionalRuleText: item.additionalRuleText,
        requiresManualAmount: true,
        notes: null,
        sortOrder: sort++,
      }),
    );
  };

  // Annex B / Section C style: "Up to 3 Hours ... $... (West Area)" — before generic "$...(Area)" parsing
  // so the timeband prefix is preserved in `notes` instead of being dropped as non-money text.
  for (let i = 0; i < lines.length; i++) {
    const parsedTb = parseTimebandAreaMoneyLine(lines[i]);
    if (!parsedTb) continue;
    rows.push(
      emitSemanticRow({
        annex: item.annex,
        sectionCode: item.sectionCode,
        groupTitle: item.groupTitle,
        baseCode: item.baseCode,
        baseLabel: item.baseLabel,
        itemNo: item.itemNo,
        variantType: "AREA",
        variantLabel: parsedTb.variantLabel,
        containerSize: null,
        equipmentType: null,
        areaScope: parsedTb.areaScope,
        rateCents: parsedTb.cents,
        rawValueText: parsedTb.cents == null ? parsedTb.raw : null,
        additionalRuleText: item.additionalRuleText,
        requiresManualAmount: parsedTb.cents == null,
        notes:
          [parsedTb.timebandNotes, unitDescriptorNotesFromCombinedValue(lines[i])]
            .filter(Boolean)
            .join(" ")
            .trim() || parsedTb.timebandNotes,
        sortOrder: sort++,
      }),
    );
    used.add(i);
  }

  // Pattern C: "$20 (Within Jurong)" style lines (can coexist with other patterns)
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const line = lines[i];
    if (!/\([^)]+\)/.test(line) || !/\$/.test(line)) continue;
    const hits = parenLineMatchesFromText(line);
    if (!hits.length) continue;
    for (const hit of hits) {
      rows.push(
        emitSemanticRow({
          annex: item.annex,
          sectionCode: item.sectionCode,
          groupTitle: item.groupTitle,
          baseCode: item.baseCode,
          baseLabel: item.baseLabel,
          itemNo: item.itemNo,
          variantType: "AREA",
          variantLabel: hit.label,
          containerSize: null,
          equipmentType: null,
          areaScope: hit.scope,
          rateCents: hit.cents,
          rawValueText: hit.cents == null ? hit.raw : null,
          additionalRuleText: item.additionalRuleText,
          requiresManualAmount: hit.cents == null,
          notes: unitDescriptorNotesFromCombinedValue(hit.raw),
          sortOrder: sort++,
        }),
      );
    }
    used.add(i);
  }

  // Labeled colon lines (equipment / area)
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const line = lines[i];
    if (!/(normal trailer|low bed|west area|out of jurong|within jurong)\s*:/i.test(line)) continue;
    const segments =
      labeledColonSegmentsFromText(line).length > 0
        ? labeledColonSegmentsFromText(line)
        : (() => {
            const [left, right] = line.split(":").map((s) => s.trim());
            return [{ left, right, raw: line }];
          })();

    for (const seg of segments) {
      const cents = parseMoneyToCents(seg.right);
      const lt = seg.left.toLowerCase();
      if (/normal trailer|low bed/.test(lt)) {
        const isLow = /low bed/.test(lt);
        rows.push(
          emitSemanticRow({
            annex: item.annex,
            sectionCode: item.sectionCode,
            groupTitle: item.groupTitle,
            baseCode: item.baseCode,
            baseLabel: item.baseLabel,
            itemNo: item.itemNo,
            variantType: "EQUIPMENT",
            variantLabel: isLow ? "Low Bed" : "Normal Trailer",
            containerSize: null,
            equipmentType: isLow ? "LOW_BED" : "NORMAL_TRAILER",
            areaScope: null,
            rateCents: cents,
            rawValueText: cents == null ? seg.raw : null,
            additionalRuleText: item.additionalRuleText,
            requiresManualAmount: cents == null,
            notes: unitDescriptorNotesFromCombinedValue(seg.right),
            sortOrder: sort++,
          }),
        );
      } else {
        const { areaScope, variantLabel } = classifyAreaLine(seg.left);
        rows.push(
          emitSemanticRow({
            annex: item.annex,
            sectionCode: item.sectionCode,
            groupTitle: item.groupTitle,
            baseCode: item.baseCode,
            baseLabel: item.baseLabel,
            itemNo: item.itemNo,
            variantType: "AREA",
            variantLabel,
            containerSize: null,
            equipmentType: null,
            areaScope,
            rateCents: cents,
            rawValueText: cents == null ? seg.raw : null,
            additionalRuleText: item.additionalRuleText,
            requiresManualAmount: cents == null,
            notes: unitDescriptorNotesFromCombinedValue(seg.right),
            sortOrder: sort++,
          }),
        );
      }
    }
    used.add(i);
  }

  // Standalone money lines (e.g. police escort additional amount after parenthesized area lines)
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const line = lines[i];
    if (!/\$/.test(line) && !/^\s*\d[\d,]*(?:\.\d{1,2})?\s*$/.test(line)) continue;
    if (/\([^)]+\)/.test(line)) continue; // handled by paren parsing paths
    const ambiguousLine = parseRateCell(line);
    if (ambiguousLine.requiresManualAmount) {
      used.add(i);
      continue;
    }
    const cents = parseMoneyToCents(line);
    if (cents == null) continue;

    const lt = line.toLowerCase();
    if (/normal trailer|low bed/.test(lt)) {
      const isLow = /low bed/.test(lt);
      rows.push(
        emitSemanticRow({
          annex: item.annex,
          sectionCode: item.sectionCode,
          groupTitle: item.groupTitle,
          baseCode: item.baseCode,
          baseLabel: item.baseLabel,
          itemNo: item.itemNo,
          variantType: "EQUIPMENT",
          variantLabel: isLow ? "Low Bed" : "Normal Trailer",
          containerSize: null,
          equipmentType: isLow ? "LOW_BED" : "NORMAL_TRAILER",
          areaScope: null,
          rateCents: cents,
          rawValueText: null,
          additionalRuleText: item.additionalRuleText,
          requiresManualAmount: false,
          notes: null,
          sortOrder: sort++,
        }),
      );
      used.add(i);
      continue;
    }

    // If it's just a bare amount, treat as escort extra when other escort/area context exists.
    const looksBareAmount = /^\$?\s*-?\d[\d,]*(?:\.\d{1,2})?\s*$/i.test(line);
    const hasEscortContext =
      /\bescort\b/i.test(combinedFull) ||
      rows.some((r) => r.areaScope === "WEST_AREA" || r.areaScope === "OUT_OF_JURONG");
    if (looksBareAmount && !/\$/.test(line) && !hasEscortContext) {
      continue;
    }
    if (looksBareAmount && hasEscortContext) {
      rows.push(
        emitSemanticRow({
          annex: item.annex,
          sectionCode: item.sectionCode,
          groupTitle: item.groupTitle,
          baseCode: item.baseCode,
          baseLabel: item.baseLabel,
          itemNo: item.itemNo,
          variantType: "AREA",
          variantLabel: "Expressway Escort Additional",
          containerSize: null,
          equipmentType: null,
          areaScope: "ESCORT_EXTRA",
          rateCents: cents,
          rawValueText: null,
          additionalRuleText: item.additionalRuleText,
          requiresManualAmount: false,
          notes: null,
          sortOrder: sort++,
        }),
      );
      used.add(i);
      continue;
    }

    // Otherwise treat as default amount for the item (often includes trailing unit text in other lines)
    const tu = trailingUnitTextAfterLastMoney(line);
    const unitNotes =
      unitDescriptorNotesFromCombinedValue(line) ??
      (tu && UNIT_DESCRIPTOR_IN_NOTES_RE.test(tu) ? tu : null);
    rows.push(
      emitSemanticRow({
        annex: item.annex,
        sectionCode: item.sectionCode,
        groupTitle: item.groupTitle,
        baseCode: item.baseCode,
        baseLabel: item.baseLabel,
        itemNo: item.itemNo,
        variantType: "DEFAULT",
        variantLabel: "Default",
        containerSize: null,
        equipmentType: null,
        areaScope: null,
        rateCents: cents,
        rawValueText: null,
        additionalRuleText: item.additionalRuleText,
        requiresManualAmount: false,
        notes: unitNotes,
        sortOrder: sort++,
      }),
    );
    used.add(i);
  }

  // Remaining non-money lines: text rules / notes
  const leftover = lines
    .map((l, idx) => ({ l, idx }))
    .filter(({ idx }) => !used.has(idx))
    .map(({ l }) => l)
    .join("\n")
    .trim();

  if (leftover) {
    const normalizedLeftover = leftover.replace(/\s+/g, " ").trim();
    const ambiguousAll = parseRateCell(combinedText);
    const leftoverIsEchoedLabel =
      !!normalizedLeftover && normalizedLeftover === item.baseLabel.trim();

    if (!(ambiguousAll.requiresManualAmount && leftoverIsEchoedLabel)) {
      const looksLikeUnitContinuation =
        !/\$/.test(normalizedLeftover) &&
        /\b(per|calendar|day|unit|trip|hour)\b/i.test(normalizedLeftover);
      const defaultSingles = rows.filter((r) => r.variantType === "DEFAULT" && r.rateCents != null);
      if (looksLikeUnitContinuation && defaultSingles.length === 1) {
        defaultSingles[0].notes = [defaultSingles[0].notes, normalizedLeftover]
          .filter(Boolean)
          .join(" ")
          .trim();
      } else if (rows.length > 0) {
        // If we already emitted structured rows, treat remaining lines as descriptive notes
        // rather than a separate "text rule" row (avoids duplicating the item label in rawValueText).
        if (normalizedLeftover && normalizedLeftover !== item.baseLabel.trim()) {
          rows[0].notes = [rows[0].notes, normalizedLeftover].filter(Boolean).join("\n").trim();
        }
      } else if (!/\$/.test(leftover) && !/^\d/.test(leftover)) {
        pushDefaultTextRule(leftover);
      } else {
        // If we still have unparsed numeric-ish content, keep it visible.
        pushDefaultTextRule(leftover);
      }
    }
  }

  if (rows.length > 0) {
    attachUnitDescriptorNotesForConsistentPricing(rows, combinedText);
    return rows;
  }

  // Default / ambiguous (whole cell)
  const parsed = parseRateCell(combinedText);
  if (parsed.requiresManualAmount) {
    const moneyishAll =
      combinedText.match(/-?\$?\s*\d[\d,]*(?:\.\d{1,2})?/g)?.filter(Boolean) ?? [];
    const ambiguousSnippet =
      moneyishAll.length >= 2 &&
      (combinedText.includes("/") || /\bto\b/i.test(combinedText) || /\bor\b/i.test(combinedText))
        ? (() => {
            const first = combinedText.indexOf(moneyishAll[0]);
            const last = combinedText.lastIndexOf(moneyishAll[moneyishAll.length - 1]);
            if (first < 0 || last < 0) return parsed.rawRateText ?? combinedText;
            const end = last + String(moneyishAll[moneyishAll.length - 1]).length;
            return combinedText.slice(first, end).trim();
          })()
        : parsed.rawRateText ?? combinedText;
    rows.push(
      emitSemanticRow({
        annex: item.annex,
        sectionCode: item.sectionCode,
        groupTitle: item.groupTitle,
        baseCode: item.baseCode,
        baseLabel: item.baseLabel,
        itemNo: item.itemNo,
        variantType: "DEFAULT",
        variantLabel: "Default",
        containerSize: null,
        equipmentType: null,
        areaScope: null,
        rateCents: null,
        rawValueText: ambiguousSnippet,
        additionalRuleText: item.additionalRuleText,
        requiresManualAmount: true,
        notes: ambiguousSnippet,
        sortOrder: sort++,
      }),
    );
    return rows;
  }

  rows.push(
    emitSemanticRow({
      annex: item.annex,
      sectionCode: item.sectionCode,
      groupTitle: item.groupTitle,
      baseCode: item.baseCode,
      baseLabel: item.baseLabel,
      itemNo: item.itemNo,
      variantType: "DEFAULT",
      variantLabel: "Default",
      containerSize: null,
      equipmentType: null,
      areaScope: null,
      rateCents: parsed.rateCents,
      rawValueText: null,
      additionalRuleText: item.additionalRuleText,
      requiresManualAmount: false,
      notes: unitDescriptorNotesFromCombinedValue(combinedText),
      sortOrder: sort++,
    }),
  );
  attachUnitDescriptorNotesForConsistentPricing(rows, combinedText);
  return rows;
}

type ParenParsed = { cents: number | null; scope: string | null; label: string; raw: string };

function parenLineMatchesFromText(text: string): ParenParsed[] {
  const out: ParenParsed[] = [];
  const re = /(\$?\s*-?\d[\d,]*(?:\.\d{1,2})?)\s*\(([^)]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const cents = parseMoneyToCents(m[1]);
    const inside = String(m[2] ?? "").trim();
    const { areaScope, variantLabel } = classifyAreaLine(inside);
    out.push({ cents, scope: areaScope, label: variantLabel, raw: m[0] });
  }
  return out;
}

export function parseAnnexQuotationSemanticRowsFromSheetRows(rawRows: any[][]): QuotationSemanticRow[] {
  const semantic: QuotationSemanticRow[] = [];
  let sortOrder = 0;

  let annex = "";
  let sectionCode = "";
  let groupTitle = "";
  let variantHeaders: VariantHeader[] = [];
  let current: BusinessItemDraft | null = null;

  const finalize = () => {
    if (!current) return;
    const emitted = emitRowsForBusinessItem(current, variantHeaders, sortOrder);
    semantic.push(...emitted);
    sortOrder += emitted.length;
    current = null;
  };

  for (const raw of rawRows) {
    const cells = normalizeRowCells(raw);
    const joined = rowJoined(cells);

    const annexLetter = joined ? detectAnnexLetter(joined) : null;
    if (annexLetter) {
      finalize();
      annex = annexLetter;
      sectionCode = "";
      groupTitle = "";
      variantHeaders = [];
      continue;
    }

    const sec = isSectionContextRow(cells);
    if (sec) {
      finalize();
      sectionCode = sec.section;
      groupTitle = sec.title;
      variantHeaders = [];
      continue;
    }

    if (joined && isStandaloneGroupHeader(joined) && cells.length <= 2) {
      finalize();
      groupTitle = joined;
      continue;
    }

    if (!isNumberedBusinessRow(cells)) {
      const vh = parseVariantHeadersFromRow(cells);
      if (vh.length >= 2) {
        finalize();
        variantHeaders = vh;
        continue;
      }
    }

    if (isNumberedBusinessRow(cells)) {
      finalize();
      const itemNo = String(cells[0]).trim();
      if (!sectionCode || !annex) continue;
      const baseCode = `${sectionCode}_${itemNo}`;
      let baseLabel = extractBaseLabelFromNumberedRow(cells);
      const additionalFromLabel = extractAdditionalRuleFromText(baseLabel);
      let additionalRuleText: string | null = additionalFromLabel;
      if (additionalFromLabel) {
        baseLabel = stripAdditionalRuleFromLabel(baseLabel, additionalFromLabel);
      }

      // Some templates put "Additional ..." in a later column on the same row.
      const firstRowCells = [...cells];
      for (let ci = 2; ci < firstRowCells.length; ci++) {
        const cell = String(firstRowCells[ci] ?? "").trim();
        if (!cell) continue;
        const add = extractAdditionalRuleFromText(cell);
        if (!add) continue;
        additionalRuleText = additionalRuleText ? `${additionalRuleText}; ${add}` : add;
        firstRowCells[ci] = "";
      }
      current = {
        annex,
        sectionCode,
        groupTitle,
        itemNo,
        baseCode,
        baseLabel,
        firstRowCells,
        continuationTexts: [],
        additionalRuleText,
      };
      continue;
    }

    if (current) {
      if (!joined) continue;
      if (/^additional\b/i.test(joined)) {
        current.additionalRuleText = current.additionalRuleText
          ? `${current.additionalRuleText}; ${joined}`
          : joined;
        continue;
      }
      current.continuationTexts.push(joined);
    }
  }
  finalize();

  return semantic;
}

export function parseAnnexQuotationSemanticRowsFromXlsxBuffer(buffer: Buffer): QuotationSemanticRow[] {
  let XLSX: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    XLSX = require("xlsx");
  } catch {
    return [];
  }
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const semantic: QuotationSemanticRow[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rawRows.length) continue;
    semantic.push(...parseAnnexQuotationSemanticRowsFromSheetRows(rawRows));
  }
  return semantic;
}

function dedupeBusinessItemsFromSemanticRows(
  semantic: QuotationSemanticRow[],
): ParsedQuotationBusinessItem[] {
  const map = new Map<string, ParsedQuotationBusinessItem>();
  for (const r of semantic) {
    const key = `${r.annex}|${r.sectionCode}|${r.itemNo}`;
    if (map.has(key)) continue;
    map.set(key, {
      annex: r.annex,
      sectionCode: r.sectionCode,
      groupTitle: r.groupTitle,
      itemNo: r.itemNo,
      baseCode: r.baseCode,
      baseLabel: r.baseLabel,
    });
  }
  return Array.from(map.values());
}

export function parseQuotationMatrixFromXlsxBuffer(buffer: Buffer): ParsedQuotationBusinessItem[] {
  const semantic = parseAnnexQuotationSemanticRowsFromXlsxBuffer(buffer);
  return dedupeBusinessItemsFromSemanticRows(semantic);
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

    const semantic = parseAnnexQuotationSemanticRowsFromSheetRows(rows);
    const parsed = semanticRowsToParsedLines(semantic);
    for (const line of parsed) {
      line.sortOrder = out.length;
      out.push(line);
    }
  }

  return out;
}

export function buildQuotationReconciliation(
  rows: ParsedQuotationBusinessItem[],
): QuotationReconciliationSummary {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = `${row.annex}/${row.sectionCode}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const expected: Record<string, number> = {
    "A/A": 8,
    "A/B": 14,
    "B/C": 5,
  };
  const warnings: string[] = [];
  for (const [key, expectedCount] of Object.entries(expected)) {
    const actual = counts[key] ?? 0;
    if (actual !== expectedCount) {
      warnings.push(
        `Reconciliation mismatch for ${key}: expected ${expectedCount}, got ${actual}`,
      );
    }
  }
  return { counts, expected, isMatch: warnings.length === 0, warnings };
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

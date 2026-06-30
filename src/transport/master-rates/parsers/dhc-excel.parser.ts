export type DhcExcelParsedItem = {
  section: string | null;
  code: string;
  label: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  rateCents: number | null;
  notes: string | null;
  yardDepot: string | null;
  oldRateCents: number | null;
  newRateCents: number | null;
  software: string | null;
  operatorCode: string | null;
  operatorName: string | null;
  effectiveDate: Date | null;
};

export type DhcExcelParseResult = {
  items: DhcExcelParsedItem[];
  summary: {
    parserVersion: string;
    sheetName: string | null;
    headerRow: number | null;
    totalRowsScanned: number;
    parsedRows: number;
    skippedRows: number;
    warnings: string[];
  };
};

type HeaderIndex = {
  yard: number;
  old: number;
  next: number;
  software: number;
  opCode: number;
  operatorName: number;
  wef: number;
};

const PARSER_VERSION = "dhc_excel_v1";

function normalizeText(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

function normalizeHeader(raw: unknown): string {
  return normalizeText(raw).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseMoneyToCents(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && !Number.isNaN(raw)) return Math.round(raw * 100);
  const text = normalizeText(raw);
  if (!text) return null;
  if (!/^-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(text)) return null;
  const n = Number(text.replace(/[$,\s]/g, ""));
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

function parseExcelDate(raw: unknown): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === "number" && !Number.isNaN(raw)) {
    // Excel serial date (1900 date system).
    const utc = Date.UTC(1899, 11, 30) + Math.round(raw) * 24 * 60 * 60 * 1000;
    const dt = new Date(utc);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const text = normalizeText(raw);
  if (!text) return null;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const dmy = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]) - 1;
    const yyyy = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const dt = new Date(Date.UTC(yyyy, mm, dd));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

function detectHeaderIndex(rows: any[][]): { headerRow: number; index: HeaderIndex } | null {
  for (let i = 0; i < rows.length; i++) {
    const normalized = (rows[i] ?? []).map((cell: unknown) => normalizeHeader(cell));
    const idx = {
      yard: normalized.findIndex((h) => h === "yard"),
      old: normalized.findIndex((h) => h === "old"),
      next: normalized.findIndex((h) => h === "new"),
      software: normalized.findIndex((h) => h === "software"),
      opCode: normalized.findIndex((h) => h === "opcode"),
      operatorName: normalized.findIndex((h) => h === "operatorname"),
      wef: normalized.findIndex((h) => h === "wef"),
    };
    if (
      idx.yard >= 0 &&
      idx.old >= 0 &&
      idx.next >= 0 &&
      idx.software >= 0 &&
      idx.opCode >= 0 &&
      idx.operatorName >= 0 &&
      idx.wef >= 0
    ) {
      return { headerRow: i, index: idx };
    }
  }
  return null;
}

export function parseDhcExcelBuffer(buffer: Buffer): DhcExcelParseResult {
  let XLSX: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    XLSX = require("xlsx");
  } catch {
    return {
      items: [],
      summary: {
        parserVersion: PARSER_VERSION,
        sheetName: null,
        headerRow: null,
        totalRowsScanned: 0,
        parsedRows: 0,
        skippedRows: 0,
        warnings: ["Excel parser unavailable (xlsx package missing)."],
      },
    };
  }

  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0] ?? null;
  if (!sheetName) {
    return {
      items: [],
      summary: {
        parserVersion: PARSER_VERSION,
        sheetName: null,
        headerRow: null,
        totalRowsScanned: 0,
        parsedRows: 0,
        skippedRows: 0,
        warnings: ["Workbook has no sheets."],
      },
    };
  }

  const ws = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const detected = detectHeaderIndex(rows);
  if (!detected) {
    return {
      items: [],
      summary: {
        parserVersion: PARSER_VERSION,
        sheetName,
        headerRow: null,
        totalRowsScanned: Math.max(0, rows.length - 1),
        parsedRows: 0,
        skippedRows: Math.max(0, rows.length - 1),
        warnings: ["Could not detect required DHC headers: Yard, Old, New, Software, Op Code, Operator Name, W.E.F"],
      },
    };
  }

  const warnings: string[] = [];
  const items: DhcExcelParsedItem[] = [];
  let skippedRows = 0;
  const { headerRow, index } = detected;
  const dataRows = rows.slice(headerRow + 1);
  const ctx: {
    yardDepot: string | null;
    oldRateCents: number | null;
    newRateCents: number | null;
    software: string | null;
    effectiveDate: Date | null;
  } = {
    yardDepot: null,
    oldRateCents: null,
    newRateCents: null,
    software: null,
    effectiveDate: null,
  };

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i] ?? [];
    const excelRowNo = headerRow + 2 + i;
    const rawYard = normalizeText(row[index.yard]);
    const rawOld = row[index.old];
    const rawNew = row[index.next];
    const rawSoftware = normalizeText(row[index.software]);
    const rawOpCode = normalizeText(row[index.opCode]);
    const rawOperator = normalizeText(row[index.operatorName]);
    const rawWef = row[index.wef];

    const rowIsFullyEmpty =
      !rawYard &&
      normalizeText(rawOld) === "" &&
      normalizeText(rawNew) === "" &&
      !rawSoftware &&
      !rawOpCode &&
      !rawOperator &&
      normalizeText(rawWef) === "";
    if (rowIsFullyEmpty) {
      continue;
    }

    if (rawYard) ctx.yardDepot = rawYard;
    if (normalizeText(rawOld) !== "") {
      const cents = parseMoneyToCents(rawOld);
      if (cents == null) warnings.push(`Row ${excelRowNo}: invalid Old value "${normalizeText(rawOld)}"`);
      else ctx.oldRateCents = cents;
    }
    if (normalizeText(rawNew) !== "") {
      const cents = parseMoneyToCents(rawNew);
      if (cents == null) warnings.push(`Row ${excelRowNo}: invalid New value "${normalizeText(rawNew)}"`);
      else ctx.newRateCents = cents;
    }
    if (rawSoftware) ctx.software = rawSoftware;
    if (normalizeText(rawWef) !== "") {
      const dt = parseExcelDate(rawWef);
      if (dt == null) warnings.push(`Row ${excelRowNo}: invalid W.E.F value "${normalizeText(rawWef)}"`);
      else ctx.effectiveDate = dt;
    }

    const operatorCode = rawOpCode || null;
    const operatorName = rawOperator || null;
    const hasOperator = Boolean(operatorCode || operatorName);
    const hasRate = ctx.oldRateCents != null || ctx.newRateCents != null;
    if (!ctx.yardDepot || !hasOperator || !hasRate) {
      skippedRows += 1;
      warnings.push(
        `Row ${excelRowNo}: skipped (yard/operator/rate context incomplete)`,
      );
      continue;
    }

    const canonicalRate = ctx.newRateCents ?? ctx.oldRateCents ?? null;
    const code = operatorCode ?? `DHC-${String(items.length + 1).padStart(3, "0")}`;
    const label = operatorName ?? operatorCode ?? code;
    items.push({
      section: ctx.yardDepot,
      code,
      label,
      description: null,
      category: "DHC_EXCEL",
      unit: null,
      rateCents: canonicalRate,
      notes: null,
      yardDepot: ctx.yardDepot,
      oldRateCents: ctx.oldRateCents,
      newRateCents: ctx.newRateCents,
      software: ctx.software,
      operatorCode,
      operatorName,
      effectiveDate: ctx.effectiveDate,
    });
  }

  return {
    items,
    summary: {
      parserVersion: PARSER_VERSION,
      sheetName,
      headerRow: headerRow + 1,
      totalRowsScanned: dataRows.length,
      parsedRows: items.length,
      skippedRows,
      warnings,
    },
  };
}

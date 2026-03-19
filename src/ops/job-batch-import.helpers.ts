import { BadRequestException } from "@nestjs/common";
import { JobType, Prisma } from "@prisma/client";
import type { JobBatchImportRowDto } from "./dto/job-batch-import.dto";

export function normalizeJobBatchText(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

/** Parse numeric cell for item qty; empty → undefined. */
export function parseItemQtyCell(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(String(value).trim());
  if (!Number.isFinite(n)) return undefined;
  return Math.max(1, Math.floor(n));
}

const HEADER_ALIASES: Record<string, keyof JobBatchImportRowDto> = {
  externalref: "externalRef",
  "external ref": "externalRef",
  "order ref": "externalRef",
  "client ref": "externalRef",
  notes: "notes",
  "pickup date": "pickupDate",
  pickupdate: "pickupDate",
  "pickup address 1": "pickupAddress1",
  "pickup address1": "pickupAddress1",
  pickupaddress1: "pickupAddress1",
  "pick up address 1": "pickupAddress1",
  pickup: "pickupAddress1",
  "pickup address 2": "pickupAddress2",
  "pickup address2": "pickupAddress2",
  pickupaddress2: "pickupAddress2",
  "pickup postal": "pickupPostal",
  "pickup postal code": "pickupPostal",
  pickuppostal: "pickupPostal",
  "pickup contact name": "pickupContactName",
  pickupcontactname: "pickupContactName",
  "pickup contact phone": "pickupContactPhone",
  pickupcontactphone: "pickupContactPhone",
  "delivery address 1": "deliveryAddress1",
  "delivery address1": "deliveryAddress1",
  deliveryaddress1: "deliveryAddress1",
  delivery: "deliveryAddress1",
  "delivery address 2": "deliveryAddress2",
  "delivery address2": "deliveryAddress2",
  deliveryaddress2: "deliveryAddress2",
  "delivery postal": "deliveryPostal",
  "delivery postal code": "deliveryPostal",
  deliverypostal: "deliveryPostal",
  "receiver name": "receiverName",
  receivername: "receiverName",
  consignee: "receiverName",
  "receiver phone": "receiverPhone",
  receiverphone: "receiverPhone",
  "receiver mobile": "receiverPhone",
  "item code": "itemCode",
  itemcode: "itemCode",
  sku: "itemCode",
  "item qty": "itemQty",
  itemqty: "itemQty",
  qty: "itemQty",
  quantity: "itemQty",
  "item description": "itemDescription",
  itemdescription: "itemDescription",
};

function normalizeHeaderKey(h: unknown): string {
  return normalizeJobBatchText(h).toLowerCase();
}

function mapHeaderToField(header: unknown): keyof JobBatchImportRowDto | null {
  const key = normalizeHeaderKey(header);
  if (!key) return null;
  return HEADER_ALIASES[key] ?? null;
}

export type ParsedJobBatchSheetRow = {
  rowNumber: number;
  /** String fields from sheet; itemQty stored via itemQtyRaw */
  strings: Partial<Record<Exclude<keyof JobBatchImportRowDto, "itemQty">, string>>;
  itemQtyRaw?: unknown;
};

function nullIfEmpty(s: string | undefined | null): string | null {
  const t = (s ?? "").trim();
  return t.length ? t : null;
}

/**
 * Build normalized DTO row from parsed cells (trimmed strings).
 */
export function buildJobBatchImportRowDto(
  parsed: ParsedJobBatchSheetRow,
): JobBatchImportRowDto {
  const s = parsed.strings;
  const itemQtyParsed = parseItemQtyCell(parsed.itemQtyRaw);

  const dto: JobBatchImportRowDto = {
    externalRef: nullIfEmpty(s.externalRef),
    notes: nullIfEmpty(s.notes),
    pickupDate: normalizeJobBatchText(s.pickupDate),
    pickupAddress1: normalizeJobBatchText(s.pickupAddress1),
    pickupAddress2: nullIfEmpty(s.pickupAddress2),
    pickupPostal: nullIfEmpty(s.pickupPostal),
    pickupContactName: nullIfEmpty(s.pickupContactName),
    pickupContactPhone: nullIfEmpty(s.pickupContactPhone),
    deliveryAddress1: normalizeJobBatchText(s.deliveryAddress1),
    deliveryAddress2: nullIfEmpty(s.deliveryAddress2),
    deliveryPostal: nullIfEmpty(s.deliveryPostal),
    receiverName: normalizeJobBatchText(s.receiverName),
    receiverPhone: normalizeJobBatchText(s.receiverPhone),
    itemCode: nullIfEmpty(s.itemCode),
    itemDescription: nullIfEmpty(s.itemDescription),
  };

  const code = dto.itemCode?.trim();
  if (code && itemQtyParsed !== undefined) {
    dto.itemQty = itemQtyParsed;
  }

  return dto;
}

const REQUIRED_BATCH_HEADERS: (keyof JobBatchImportRowDto)[] = [
  "pickupDate",
  "pickupAddress1",
  "deliveryAddress1",
  "receiverName",
  "receiverPhone",
];

export function assertJobBatchImportTemplateHasHeaders(
  colToField: (keyof JobBatchImportRowDto | null)[],
): void {
  const set = new Set(
    colToField.filter((f): f is keyof JobBatchImportRowDto => f != null),
  );
  const missing = REQUIRED_BATCH_HEADERS.filter((h) => !set.has(h));
  if (missing.length > 0) {
    throw new BadRequestException(
      `Excel template is missing required column(s): ${missing.join(", ")}`,
    );
  }
}

/** Trim and normalize row from API confirm body. */
export function normalizeJobBatchImportRowFromBody(
  row: JobBatchImportRowDto,
): JobBatchImportRowDto {
  return buildJobBatchImportRowDto({
    rowNumber: 0,
    strings: {
      externalRef: row.externalRef ?? "",
      notes: row.notes ?? "",
      pickupDate: row.pickupDate,
      pickupAddress1: row.pickupAddress1,
      pickupAddress2: row.pickupAddress2 ?? "",
      pickupPostal: row.pickupPostal ?? "",
      pickupContactName: row.pickupContactName ?? "",
      pickupContactPhone: row.pickupContactPhone ?? "",
      deliveryAddress1: row.deliveryAddress1,
      deliveryAddress2: row.deliveryAddress2 ?? "",
      deliveryPostal: row.deliveryPostal ?? "",
      receiverName: row.receiverName,
      receiverPhone: row.receiverPhone,
      itemCode: row.itemCode ?? "",
      itemDescription: row.itemDescription ?? "",
    },
    itemQtyRaw: row.itemQty,
  });
}

/**
 * Validate normalized row (field-level messages). No DB calls.
 */
export function validateJobBatchImportRowFields(
  row: JobBatchImportRowDto,
): string[] {
  const errors: string[] = [];

  if (!row.pickupDate?.trim()) errors.push("pickupDate: required");
  else {
    const d = new Date(row.pickupDate);
    if (Number.isNaN(d.getTime())) {
      errors.push("pickupDate: must be a valid date (YYYY-MM-DD)");
    }
  }

  if (!row.pickupAddress1?.trim()) errors.push("pickupAddress1: required");
  if (!row.deliveryAddress1?.trim()) errors.push("deliveryAddress1: required");
  if (!row.receiverName?.trim()) errors.push("receiverName: required");
  if (!row.receiverPhone?.trim()) errors.push("receiverPhone: required");

  const code = row.itemCode?.trim();
  if (code && row.itemQty === undefined) {
    errors.push("itemQty: required when itemCode is set");
  }
  if (row.itemQty !== undefined && !code) {
    errors.push("itemCode: required when itemQty is set");
  }

  return errors;
}

export type BatchImportJobItemCreate = {
  tenantId: string;
  itemCode: string;
  description: string | null;
  qty: number;
};

export function buildBatchImportJobItems(
  tenantId: string,
  row: JobBatchImportRowDto,
): BatchImportJobItemCreate[] {
  const code = row.itemCode?.trim();
  if (code) {
    return [
      {
        tenantId,
        itemCode: code,
        description: row.itemDescription?.trim() || null,
        qty: Math.max(1, row.itemQty ?? 1),
      },
    ];
  }
  return [
    {
      tenantId,
      itemCode: "UNSPECIFIED",
      description: "Imported job item",
      qty: 1,
    },
  ];
}

export function buildBatchImportJobCreateData(input: {
  tenantId: string;
  customerCompanyId: string;
  jobType: JobType;
  internalRef: string;
  status: import("@prisma/client").JobStatus;
  row: JobBatchImportRowDto;
}): Prisma.JobUncheckedCreateInput {
  const { tenantId, customerCompanyId, jobType, internalRef, status, row } =
    input;

  const items = buildBatchImportJobItems(tenantId, row);

  return {
    tenantId,
    customerCompanyId,
    internalRef,
    externalRef: row.externalRef?.trim() || null,
    jobType,
    status,
    notes: row.notes?.trim() || null,
    pickupDate: row.pickupDate ? new Date(row.pickupDate) : null,
    pickupAddress1: row.pickupAddress1.trim(),
    pickupAddress2: row.pickupAddress2?.trim() || null,
    pickupPostal: row.pickupPostal?.trim() || null,
    pickupContactName: row.pickupContactName?.trim() || null,
    pickupContactPhone: row.pickupContactPhone?.trim() || null,
    deliveryAddress1: row.deliveryAddress1.trim(),
    deliveryAddress2: row.deliveryAddress2?.trim() || null,
    deliveryPostal: row.deliveryPostal?.trim() || null,
    receiverName: row.receiverName.trim(),
    receiverPhone: row.receiverPhone.trim(),
    items: {
      create: items.map((it) => ({
        tenantId: it.tenantId,
        itemCode: it.itemCode,
        description: it.description,
        qty: it.qty,
      })),
    },
  };
}

/**
 * Header-based Excel parse (first sheet). First row = headers.
 */
export function parseJobBatchImportSheet(buffer: Buffer): ParsedJobBatchSheetRow[] {
  let XLSX: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    XLSX = require("xlsx");
  } catch {
    throw new BadRequestException(
      "Excel import requires xlsx package (npm install xlsx)",
    );
  }

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];

  const sheet = workbook.Sheets[firstSheet];
  if (!sheet) return [];

  const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });
  if (rawRows.length < 1) return [];

  const headerRow = rawRows[0] as any[];
  const colToField: (keyof JobBatchImportRowDto | null)[] = headerRow.map(
    (h) => mapHeaderToField(h),
  );

  assertJobBatchImportTemplateHasHeaders(colToField);

  if (rawRows.length < 2) return [];

  const out: ParsedJobBatchSheetRow[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i] as any[];
    if (!row || row.every((c) => c == null || String(c).trim() === "")) {
      continue;
    }

    const strings: ParsedJobBatchSheetRow["strings"] = {};
    let itemQtyRaw: unknown = undefined;

    for (let c = 0; c < colToField.length; c++) {
      const field = colToField[c];
      if (!field) continue;
      if (field === "itemQty") {
        itemQtyRaw = row[c];
        continue;
      }
      const text = normalizeJobBatchText(row[c]);
      if (text) (strings as any)[field] = text;
    }

    out.push({ rowNumber: i + 1, strings, itemQtyRaw });
  }

  return out;
}

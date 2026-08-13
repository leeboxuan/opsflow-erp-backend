import { JobChargeSourceType } from "@prisma/client";

export type BoundCustomerQuotationLine = {
  id: string;
  code: string;
  label: string;
  description?: string | null;
  unit?: string | null;
  unitPriceCents: number;
  currency?: string | null;
  taxCode?: string | null;
  taxRate?: number | null;
  requiresManualAmount?: boolean | null;
  quotation: {
    id: string;
    quotationNo: string;
    title?: string | null;
    status: string;
    customerCompanyId: string;
  };
};

export type ActiveCustomerRateTemplateRow = {
  id: string;
  code: string;
  label: string;
  description?: string | null;
  template: { id: string; name: string };
};

export const CHARGE_OPTION_SOURCE = {
  CUSTOMER_QUOTATION: "CUSTOMER_QUOTATION",
  CUSTOMER_RATE_TEMPLATE: "CUSTOMER_RATE_TEMPLATE",
  DHC_REFERENCE: "DHC_REFERENCE",
  MANUAL: "MANUAL",
} as const;

export type ChargeOptionSource =
  (typeof CHARGE_OPTION_SOURCE)[keyof typeof CHARGE_OPTION_SOURCE];

export function normalizeOptionalId(
  value?: string | null,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function jobChargeQtyFromQuotationQty(
  qty: number | null | undefined,
): number {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.trunc(n));
}

type ProvenanceMeta = {
  quotationSnapshot?: { quotationNo?: unknown };
  customerRateTemplateSnapshot?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function jobChargeProvenanceLabel(input: {
  sourceType: string;
  sourceCustomerQuotationLineId?: string | null;
  metadataJson?: unknown;
}): string {
  const meta = asRecord(input.metadataJson) as ProvenanceMeta | null;
  if (input.sourceType === JobChargeSourceType.DHC_REFERENCE) {
    return "DHC Reference";
  }
  const quotationNo =
    typeof meta?.quotationSnapshot?.quotationNo === "string"
      ? meta.quotationSnapshot.quotationNo.trim()
      : "";
  if (
    input.sourceType === JobChargeSourceType.CUSTOMER_QUOTATION &&
    (input.sourceCustomerQuotationLineId || quotationNo)
  ) {
    return quotationNo ? `From ${quotationNo}` : "From quotation";
  }
  if (input.sourceType === JobChargeSourceType.CUSTOMER_QUOTATION) {
    return "Legacy master rate";
  }
  if (meta?.customerRateTemplateSnapshot) {
    return "Customer rates";
  }
  return "Manual";
}

export function mapCustomerQuotationLinesToChargeOptions(
  lines: Array<{
    id: string;
    code: string;
    label: string;
    description?: string | null;
    unit?: string | null;
    qty?: number | null;
    unitPriceCents?: number | null;
    currency?: string | null;
    taxCode?: string | null;
    taxRate?: number | null;
    requiresManualAmount?: boolean | null;
    sortOrder?: number | null;
  }>,
  quotation: { id: string; quotationNo: string; title?: string | null },
) {
  return lines.map((line) => ({
    id: line.id,
    code: line.code,
    label: line.label,
    description: line.description ?? null,
    unit: line.unit ?? null,
    section: null as string | null,
    defaultQty: jobChargeQtyFromQuotationQty(line.qty),
    unitPriceCents: Number.isInteger(line.unitPriceCents)
      ? line.unitPriceCents
      : null,
    currency: line.currency ?? "SGD",
    taxCode: line.taxCode ?? "SR",
    taxRateBasisPoints: Number.isInteger(line.taxRate) ? line.taxRate : 900,
    requiresManualAmount: !!line.requiresManualAmount,
    source: CHARGE_OPTION_SOURCE.CUSTOMER_QUOTATION,
    sourceCustomerQuotationLineId: line.id,
    quotationId: quotation.id,
    quotationNo: quotation.quotationNo,
    quotationTitle: quotation.title ?? null,
    sortOrder: line.sortOrder ?? 0,
  }));
}

export function mapCustomerRateTemplateRowsToChargeOptions(
  rows: Array<{
    id: string;
    code: string;
    label: string;
    description?: string | null;
    unit?: string | null;
    section?: string | null;
    rateCents?: number | null;
    currency?: string | null;
    requiresManualAmount?: boolean | null;
    hasMultipleRates?: boolean | null;
    rateOptionsJson?: unknown;
    sortOrder?: number | null;
  }>,
  template: { id: string; name: string },
) {
  return rows.map((row) => {
    const variants = Array.isArray(row.rateOptionsJson)
      ? row.rateOptionsJson
          .map((option, index) => {
            const rec = asRecord(option);
            if (!rec) return null;
            const amountCents = Number(
              rec.amountCents ?? rec.unitPriceCents ?? rec.rateCents,
            );
            if (!Number.isInteger(amountCents)) return null;
            return {
              label: String(rec.label ?? rec.name ?? `Option ${index + 1}`),
              amountCents,
            };
          })
          .filter(
            (v): v is { label: string; amountCents: number } => v != null,
          )
      : [];
    return {
      id: row.id,
      code: row.code,
      label: row.label,
      description: row.description ?? null,
      unit: row.unit ?? null,
      section: row.section ?? null,
      defaultQty: 1,
      unitPriceCents: Number.isInteger(row.rateCents) ? row.rateCents : null,
      currency: row.currency ?? "SGD",
      taxCode: "SR",
      taxRateBasisPoints: 900,
      requiresManualAmount:
        !!row.requiresManualAmount ||
        (!Number.isInteger(row.rateCents) && variants.length === 0),
      variants,
      source: CHARGE_OPTION_SOURCE.CUSTOMER_RATE_TEMPLATE,
      sourceCustomerQuotationLineId: null,
      templateId: template.id,
      templateName: template.name,
      sortOrder: row.sortOrder ?? 0,
    };
  });
}

export function buildCustomerQuotationChargeSnapshot(input: {
  line: {
    id: string;
    code: string;
    label: string;
    description?: string | null;
    unit?: string | null;
    unitPriceCents: number;
    currency?: string | null;
    taxCode?: string | null;
    taxRate?: number | null;
    requiresManualAmount?: boolean | null;
  };
  quotation: {
    id: string;
    quotationNo: string;
    title?: string | null;
  };
  qty: number;
  unitPriceCents: number;
  capturedAt: Date;
}) {
  const qty = jobChargeQtyFromQuotationQty(input.qty);
  const unitPriceCents = input.unitPriceCents;
  const amountCents = qty * unitPriceCents;
  const taxCode = input.line.taxCode ?? "SR";
  const taxRateBasisPoints = Number.isInteger(input.line.taxRate)
    ? (input.line.taxRate as number)
    : 900;
  return {
    sourceType: JobChargeSourceType.CUSTOMER_QUOTATION,
    sourceRefId: input.line.id,
    sourceCustomerQuotationItemId: null as string | null,
    sourceCustomerQuotationLineId: input.line.id,
    code: input.line.code,
    label: input.line.label,
    description: input.line.description ?? null,
    qty,
    unitPriceCents,
    amountCents,
    currency: input.line.currency ?? "SGD",
    taxable: taxRateBasisPoints > 0 && taxCode !== "ZR",
    taxCode,
    taxRateBasisPoints,
    metadataJson: {
      quotationSnapshot: {
        quotationId: input.quotation.id,
        quotationNo: input.quotation.quotationNo,
        quotationTitle: input.quotation.title ?? null,
        lineId: input.line.id,
        code: input.line.code,
        label: input.line.label,
        description: input.line.description ?? null,
        unit: input.line.unit ?? null,
        selectedRateCents: unitPriceCents,
        selectedAmountCents: amountCents,
        capturedAt: input.capturedAt.toISOString(),
      },
    },
  };
}

export function buildCustomerRateTemplateChargeSnapshot(input: {
  row: {
    id: string;
    code: string;
    label: string;
    description?: string | null;
  };
  template: { id: string; name: string };
  qty: number;
  unitPriceCents: number;
  currency?: string;
  taxable?: boolean;
  taxCode?: string | null;
  taxRateBasisPoints?: number | null;
  capturedAt: Date;
}) {
  const qty = jobChargeQtyFromQuotationQty(input.qty);
  const amountCents = qty * input.unitPriceCents;
  return {
    sourceType: JobChargeSourceType.MANUAL,
    sourceRefId: input.row.id,
    sourceCustomerQuotationItemId: null as string | null,
    sourceCustomerQuotationLineId: null as string | null,
    code: input.row.code,
    label: input.row.label,
    description: input.row.description ?? null,
    qty,
    unitPriceCents: input.unitPriceCents,
    amountCents,
    currency: input.currency ?? "SGD",
    taxable: input.taxable ?? true,
    taxCode: input.taxCode ?? "SR",
    taxRateBasisPoints: input.taxRateBasisPoints ?? 900,
    metadataJson: {
      customerRateTemplateSnapshot: {
        templateId: input.template.id,
        templateName: input.template.name,
        rowId: input.row.id,
        code: input.row.code,
        label: input.row.label,
        capturedAt: input.capturedAt.toISOString(),
      },
    },
  };
}

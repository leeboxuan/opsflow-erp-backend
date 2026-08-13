export const INVOICE_STATUS = {
  DRAFT: "Draft",
  SENT: "Sent",
  ISSUED: "Issued",
  PAID: "Paid",
  VOID: "Void",
} as const;

export type InvoiceStatusValue =
  (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

export function isInvoiceDraft(status?: string | null): boolean {
  return status === INVOICE_STATUS.DRAFT;
}

export function isInvoiceRecognized(status?: string | null): boolean {
  return (
    status === INVOICE_STATUS.SENT ||
    status === INVOICE_STATUS.ISSUED ||
    status === INVOICE_STATUS.PAID
  );
}

export function isInvoicePaid(status?: string | null): boolean {
  return status === INVOICE_STATUS.PAID;
}

export function isInvoiceVoid(status?: string | null): boolean {
  return status === INVOICE_STATUS.VOID;
}

/** Draft/Sent/Issued/Paid reserve JobCharges on their lines. Void releases them. */
export function isInvoiceReserving(status?: string | null): boolean {
  return isInvoiceDraft(status) || isInvoiceRecognized(status);
}

export function isInvoiceIssuedLike(status?: string | null): boolean {
  return status === INVOICE_STATUS.SENT || status === INVOICE_STATUS.ISSUED;
}

export function canMarkInvoicePaid(status?: string | null): boolean {
  return isInvoiceIssuedLike(status);
}

export function canRevertInvoiceToDraft(status?: string | null): boolean {
  return isInvoiceIssuedLike(status);
}

export function canVoidInvoice(status?: string | null): boolean {
  return isInvoiceDraft(status) || isInvoiceIssuedLike(status);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function uniqueNonEmptyIds(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function sourceJobIdsFromSnapshot(snapshot: unknown): string[] {
  const rec = asRecord(snapshot);
  const raw = rec?.sourceJobIds;
  return Array.isArray(raw) ? uniqueNonEmptyIds(raw.map((id) => String(id))) : [];
}

/** Legacy compatibility: scalar sourceJobId + snapshot.sourceJobIds. Not the integrity boundary. */
export function resolveInvoiceSourceJobIds(input: {
  sourceJobId?: string | null;
  snapshot?: unknown;
  sourceJobIds?: string[] | null;
}): string[] {
  return uniqueNonEmptyIds([
    input.sourceJobId,
    ...(input.sourceJobIds ?? []),
    ...sourceJobIdsFromSnapshot(input.snapshot),
  ]);
}

export function jobChargeAlreadyBilledMessage(chargeIds: string[]): string {
  return `JobCharge already billed on an active invoice: ${chargeIds.join(", ")}`;
}

export function mixedQuotationMessage(): string {
  return "An invoice cannot mix JobCharges governed by different commercial quotations";
}

export function quotationMismatchMessage(): string {
  return "Selected JobCharges must belong to Jobs governed by this invoice's commercial quotation";
}

export function reservedJobChargeMutationMessage(label: string): string {
  return `JobCharge "${label}" is reserved on an invoice and cannot be edited or deleted`;
}

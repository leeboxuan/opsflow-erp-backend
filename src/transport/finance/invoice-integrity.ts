export {
  INVOICE_STATUS,
  type InvoiceStatusValue,
  isInvoiceDraft,
  isInvoiceGenerated,
  isInvoiceIssued,
  isInvoicePaid,
  isInvoiceVoid,
  isInvoiceRecognized,
  isInvoiceReserving,
  isInvoiceFrozen,
  isInvoiceEditable,
  canGenerateInvoice,
  canIssueInvoice,
  canMarkInvoicePaid,
  canVoidInvoice,
} from "./invoice-status";

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

import { BadRequestException, ConflictException } from "@nestjs/common";

export const INVOICE_STATUS = {
  DRAFT: "DRAFT",
  GENERATED: "GENERATED",
  ISSUED: "ISSUED",
  PAID: "PAID",
  VOID: "VOID",
} as const;

export type InvoiceStatusValue =
  (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

const CANONICAL = new Set<string>(Object.values(INVOICE_STATUS));

export function normalizeInvoiceStatus(
  status?: string | null,
): InvoiceStatusValue | null {
  const raw = String(status ?? "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (CANONICAL.has(upper)) return upper as InvoiceStatusValue;
  return null;
}

export function isInvoiceDraft(status?: string | null): boolean {
  return normalizeInvoiceStatus(status) === INVOICE_STATUS.DRAFT;
}

export function isInvoiceGenerated(status?: string | null): boolean {
  return normalizeInvoiceStatus(status) === INVOICE_STATUS.GENERATED;
}

export function isInvoiceIssued(status?: string | null): boolean {
  return normalizeInvoiceStatus(status) === INVOICE_STATUS.ISSUED;
}

export function isInvoicePaid(status?: string | null): boolean {
  return normalizeInvoiceStatus(status) === INVOICE_STATUS.PAID;
}

export function isInvoiceVoid(status?: string | null): boolean {
  return normalizeInvoiceStatus(status) === INVOICE_STATUS.VOID;
}

/** Officially billed: ISSUED or PAID. GENERATED is frozen but not issued. */
export function isInvoiceRecognized(status?: string | null): boolean {
  const value = normalizeInvoiceStatus(status);
  return value === INVOICE_STATUS.ISSUED || value === INVOICE_STATUS.PAID;
}

/** Draft/Generated/Issued/Paid reserve JobCharges. Void releases them. */
export function isInvoiceReserving(status?: string | null): boolean {
  const value = normalizeInvoiceStatus(status);
  return (
    value === INVOICE_STATUS.DRAFT ||
    value === INVOICE_STATUS.GENERATED ||
    value === INVOICE_STATUS.ISSUED ||
    value === INVOICE_STATUS.PAID
  );
}

export function isInvoiceFrozen(status?: string | null): boolean {
  const value = normalizeInvoiceStatus(status);
  return (
    value === INVOICE_STATUS.GENERATED ||
    value === INVOICE_STATUS.ISSUED ||
    value === INVOICE_STATUS.PAID
  );
}

export function isInvoiceEditable(status?: string | null): boolean {
  return isInvoiceDraft(status);
}

export function hasFrozenInvoiceArtifact(invoice: {
  pdfKey?: string | null;
  pdfGeneratedAt?: Date | string | null;
}): boolean {
  return Boolean(String(invoice.pdfKey ?? "").trim()) && Boolean(invoice.pdfGeneratedAt);
}

export function frozenInvoiceArtifactIsConsistent(invoice: {
  pdfKey?: string | null;
  pdfGeneratedAt?: Date | string | null;
  documentStorageKey?: string | null;
}): boolean {
  if (!hasFrozenInvoiceArtifact(invoice)) return false;
  const pdfKey = String(invoice.pdfKey ?? "").trim();
  const documentKey = String(invoice.documentStorageKey ?? "").trim();
  if (documentKey && documentKey !== pdfKey) return false;
  return true;
}

export function canGenerateInvoice(status?: string | null): boolean {
  return isInvoiceDraft(status);
}

export function canIssueInvoice(status?: string | null): boolean {
  return isInvoiceGenerated(status);
}

export function canMarkInvoicePaid(status?: string | null): boolean {
  return isInvoiceIssued(status);
}

export function canVoidInvoice(status?: string | null): boolean {
  return (
    isInvoiceDraft(status) ||
    isInvoiceGenerated(status) ||
    isInvoiceIssued(status)
  );
}

export const INVOICE_TRANSITIONS: Record<
  InvoiceStatusValue,
  readonly InvoiceStatusValue[]
> = {
  DRAFT: [INVOICE_STATUS.GENERATED, INVOICE_STATUS.VOID],
  GENERATED: [INVOICE_STATUS.ISSUED, INVOICE_STATUS.VOID],
  ISSUED: [INVOICE_STATUS.PAID, INVOICE_STATUS.VOID],
  PAID: [],
  VOID: [],
};

export function canTransitionInvoice(
  from?: string | null,
  to?: string | null,
): boolean {
  const source = normalizeInvoiceStatus(from);
  const target = normalizeInvoiceStatus(to);
  if (!source || !target || source === target) return false;
  return INVOICE_TRANSITIONS[source].includes(target);
}

export function assertInvoiceTransition(
  from?: string | null,
  to?: string | null,
  message?: string,
): void {
  if (!canTransitionInvoice(from, to)) {
    throw new BadRequestException(
      message ??
        `Invoice cannot transition from ${String(from ?? "unknown")} to ${String(to ?? "unknown")}`,
    );
  }
}

export function invoiceMustGenerateBeforeIssueMessage(): string {
  return "Invoice must be GENERATED before it can be ISSUED";
}

export function invoiceMustIssueBeforePaidMessage(): string {
  return "Only ISSUED invoices can be marked PAID";
}

export function paidInvoicesCannotBeVoidedMessage(): string {
  return "Paid invoices cannot be voided in this phase";
}

export function invoiceCannotGenerateFromStatusMessage(status?: string | null): string {
  return `Invoice PDF cannot be generated or replaced from status ${String(status ?? "unknown")}`;
}

export function invoiceGeneratedArtifactCorruptMessage(): string {
  return "Invoice GENERATED status is missing consistent frozen PDF metadata";
}

export function invoiceCannotRevertToDraftMessage(): string {
  return "GENERATED and ISSUED invoices cannot revert to DRAFT";
}

export function assertGeneratedFrozenArtifact(invoice: {
  status?: string | null;
  pdfKey?: string | null;
  pdfGeneratedAt?: Date | string | null;
  documentStorageKey?: string | null;
}): void {
  if (!isInvoiceGenerated(invoice.status)) return;
  if (!frozenInvoiceArtifactIsConsistent(invoice)) {
    throw new ConflictException(invoiceGeneratedArtifactCorruptMessage());
  }
}

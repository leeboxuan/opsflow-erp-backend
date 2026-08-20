import { isInvoiceRecognized } from "./invoice-status";
import { JOB_FINANCE_CURRENCY } from "./job-finance-summary.helpers";

/**
 * Phase 3 invoice → job revenue attribution (canonical provenance)
 * -----------------------------------------------------------------
 * Attributable job revenue is the sum of **charge-backed invoice line** amounts
 * on recognized invoices (ISSUED | PAID), scoped to the same tenant and SGD:
 *
 *   per line: amountCents + taxCents
 *   provenance: InvoiceLineItem.jobChargeId → JobCharge.jobId
 *
 * Explicitly **not** used for amount attribution:
 * - Invoice.totalCents (would dump a multi-job invoice onto one job)
 * - Invoice.sourceJobId / snapshot.sourceJobIds alone (identity/discovery only;
 *   not a substitute for charge provenance)
 *
 * Tax:
 * - Line-level `taxCents` travels with the line to the owning job.
 * - Invoice-level `taxCents` is not re-allocated. Charge-backed invoices already
 *   carry tax on lines; any invoice-level tax without attributable lines is
 *   treated as **unattributable** (not invented onto sourceJobId).
 *
 * Manual / legacy / unattributable lines (`jobChargeId` null, or charge missing /
 * cross-tenant): **excluded** from every job's `invoiceRevenueCents`. Do not
 * invent assignment via sourceJobId.
 *
 * Recognition: ISSUED and PAID only. DRAFT, GENERATED, VOID contribute nothing.
 *
 * Dedup: each invoice line id is counted at most once. Multiple legitimate
 * partial ISSUED/PAID invoices for a job are additive.
 *
 * A job with no attributable recognized lines → `invoiceRevenueCents = null`
 * (NOT_INVOICED), even if sourceJobId points at the job.
 */

export type InvoiceLineAttributionInput = {
  lineId: string;
  lineTenantId: string;
  amountCents: number;
  taxCents: number;
  jobChargeId: string | null;
  /** Owning job from JobCharge; null when unattributable. */
  jobId: string | null;
  chargeTenantId: string | null;
  invoiceId: string;
  invoiceTenantId: string;
  invoiceStatus: string | null | undefined;
  invoiceCurrency: string | null | undefined;
};

export function lineRevenueCents(line: {
  amountCents: number;
  taxCents: number;
}): number {
  const amount = Math.max(0, Math.trunc(Number(line.amountCents) || 0));
  const tax = Math.max(0, Math.trunc(Number(line.taxCents) || 0));
  return amount + tax;
}

export function isChargeBackedAttributableLine(
  line: InvoiceLineAttributionInput,
  tenantId: string,
): boolean {
  if (!line.jobChargeId || !line.jobId) return false;
  if (!isInvoiceRecognized(line.invoiceStatus)) return false;
  const currency = String(line.invoiceCurrency ?? "")
    .trim()
    .toUpperCase();
  if (currency !== JOB_FINANCE_CURRENCY) return false;
  if (line.lineTenantId !== tenantId) return false;
  if (line.invoiceTenantId !== tenantId) return false;
  if (line.chargeTenantId !== tenantId) return false;
  return true;
}

/**
 * Sum attributable revenue per job. Jobs with zero attributable lines are absent
 * from the map (caller treats absence as `invoiceRevenueCents = null`).
 */
export function aggregateAttributableInvoiceRevenueByJob(
  lines: InvoiceLineAttributionInput[],
  tenantId: string,
  jobIds?: ReadonlySet<string> | readonly string[],
): Map<string, number> {
  const allow =
    jobIds == null
      ? null
      : jobIds instanceof Set
        ? jobIds
        : new Set(jobIds);

  const seenLineIds = new Set<string>();
  const byJob = new Map<string, number>();

  for (const line of lines) {
    if (!isChargeBackedAttributableLine(line, tenantId)) continue;
    if (allow && !allow.has(line.jobId!)) continue;
    if (seenLineIds.has(line.lineId)) continue;
    seenLineIds.add(line.lineId);

    const cents = lineRevenueCents(line);
    byJob.set(line.jobId!, (byJob.get(line.jobId!) ?? 0) + cents);
  }

  return byJob;
}

/** Revenue on recognized invoices that cannot be assigned to a job without inventing provenance. */
export function sumUnattributableRecognizedLineRevenueCents(
  lines: InvoiceLineAttributionInput[],
  tenantId: string,
): number {
  const seenLineIds = new Set<string>();
  let total = 0;
  for (const line of lines) {
    if (seenLineIds.has(line.lineId)) continue;
    seenLineIds.add(line.lineId);
    if (line.lineTenantId !== tenantId || line.invoiceTenantId !== tenantId) {
      continue;
    }
    if (!isInvoiceRecognized(line.invoiceStatus)) continue;
    const currency = String(line.invoiceCurrency ?? "")
      .trim()
      .toUpperCase();
    if (currency !== JOB_FINANCE_CURRENCY) continue;
    if (isChargeBackedAttributableLine(line, tenantId)) continue;
    total += lineRevenueCents(line);
  }
  return total;
}

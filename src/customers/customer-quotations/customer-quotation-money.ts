/**
 * Money helpers aligned with invoice tax math (basis points / 10000).
 * Quantity supports up to 3 decimal places via milli-units to avoid float drift.
 */

export const QTY_SCALE = 1000;
export const DEFAULT_TAX_RATE_BP = 900;

/** Reject qty with more than 3 decimal places; return milli-units. */
export function qtyToMillis(qty: number): number {
  if (!Number.isFinite(qty) || qty < 0) {
    throw new Error("Invalid qty");
  }
  const millis = Math.round(qty * QTY_SCALE);
  if (Math.abs(qty * QTY_SCALE - millis) > 1e-6) {
    throw new Error("qty supports at most 3 decimal places");
  }
  return millis;
}

/** amountCents = round(qty * unitPriceCents) using milli-units. */
export function lineAmountCents(qty: number, unitPriceCents: number): number {
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
    throw new Error("Invalid unitPriceCents");
  }
  const millis = qtyToMillis(qty);
  return Math.round((millis * unitPriceCents) / QTY_SCALE);
}

/** taxCents = round(amountCents * taxRateBp / 10000) — same as invoices.service. */
export function lineTaxCents(amountCents: number, taxRateBp: number): number {
  if (!Number.isInteger(taxRateBp) || taxRateBp < 0) {
    throw new Error("Invalid taxRate");
  }
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error("Invalid amountCents");
  }
  return taxRateBp > 0 ? Math.round((amountCents * taxRateBp) / 10000) : 0;
}

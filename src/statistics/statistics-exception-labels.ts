export const EXCEPTION_KEY_LABELS: Record<string, string> = {
  ex_job_missing_charges: "Missing Job Charges",
  ex_trip_missing_payout: "Missing Trip Payout",
  ex_ready_not_invoiced: "Ready to invoice but not invoiced",
  ex_trip_missing_required_docs: "Missing required documents",
  ex_stale_operational_work: "Stale operational work",
  ex_cancelled_trip: "Cancelled trip",
  ex_invalid_timestamps: "Invalid timestamps",
  ex_orphan_invoice_job_link: "Invoice linkage issue",
  ex_excluded_from_profit: "Excluded from profit",
};

export function formatExceptionKeyLabel(key: string): string {
  return EXCEPTION_KEY_LABELS[key] ?? key;
}

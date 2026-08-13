/**
 * Management-facing wording for Statistics limitation codes.
 * Boss-facing Excel Notes and UI copy must use these strings, never the codes.
 */
export const STATISTICS_LIMITATION_NOTES: Record<string, string> = {
  completed_trips_missing_closed_at_excluded:
    "Completed trips without a recorded close time are excluded from dated completed-trip counts.",
  active_trips_are_current_snapshot:
    "Active and pending trips are a live snapshot, not a historical count for the selected period.",
  cancelled_trip_date_uses_updated_at:
    "Cancelled trip reporting currently uses the trip's last-updated date where no dedicated cancellation timestamp exists.",
  active_assignments_are_current_snapshot:
    "Active driver and vehicle assignments are a current snapshot, not a full historical assignment ledger.",
  reassignment_history_is_partial:
    "Driver reassignment counts use partial audit history (trip driver reassigned events) and may under-count older changes.",
  required_document_completion_is_partial:
    "Required-document completion is evaluated only where a trip completion rule can be resolved.",
  required_document_rules_unavailable:
    "This row has no resolvable required-document rule, so document completion is shown as unavailable.",
  invalid_trip_durations_excluded:
    "Trips with missing or inverted start/close times are excluded from duration averages.",
  job_charges_are_mutable:
    "Job Charges are persisted customer-facing snapshots and may still be edited after the reporting window.",
  published_trip_payouts_are_frozen:
    "Published trip payouts are frozen snapshots. Later driver-rate master edits do not change recorded payout.",
  payout_currency_assumed_sgd:
    "Driver payout is currently treated as SGD. Do not mix it with other currencies.",
  paid_invoice_date_uses_paid_at:
    "Paid invoice value is dated by the invoice paid-at timestamp.",
  invoice_snapshot_job_links_not_scanned:
    "Invoice snapshot job linkage is not fully scanned in this release; some legacy invoices may be incomplete.",
  invalid_currency_records_excluded:
    "Records with invalid currency codes were excluded from finance totals.",
  profit_currency_mismatches_excluded:
    "Gross profit excludes work where customer charges and driver payout are not in the same currency.",
  gross_margin_unavailable_for_nonpositive_eligible_revenue:
    "Gross margin is not shown when eligible Job Charges are zero or negative.",
  exceptions_require_transport_and_finance_entitlements:
    "Exception reporting requires both Transport and Finance modules.",
  stale_operational_work_is_current_snapshot:
    "Stale-work exceptions are evaluated against the current open-trip snapshot.",
  closed_at_null_invalid_timestamps_are_current_snapshot:
    "Invalid-timestamp exceptions for missing close times are evaluated on the current completed-trip snapshot.",
  required_document_rules_missing_are_not_confirmed_exceptions:
    "Trips without a resolvable document rule are not raised as missing-document exceptions.",
  invoice_snapshot_job_linkage_is_partial:
    "Some historical invoices may lack JobCharge provenance, so invoice-job linkage can be incomplete.",
  charges_and_payout_lines_are_mutable:
    "Charge and unpublished payout lines may still change after they appear in a report.",
  container_movement_uses_trip_job_item:
    "Container movements are counted from verified Trip–Job Item links, not from trip display fields.",
  trip_container_number_cache_is_not_authoritative:
    "The trip container-number display cache is not used to count movements and cannot create extra rows.",
  cancelled_trips_are_not_container_movements:
    "Cancelled trips are excluded from container movement, unique-container, and drivers-touched counts.",
  container_size_inferred_from_job_item_description:
    "Container size/type is inferred from the job item description when no dedicated size field exists. Unrecognised values are shown as recorded.",
  lane_names_use_trip_origin_destination_labels:
    "Lane names use each trip's origin and destination labels. Missing labels are reported as unspecified rather than guessed from templates.",
  gps_distance_not_reported:
    "Distance travelled is not reported because GPS/route distance is not yet a canonical trip statistic.",
  customer_commercial_uses_canonical_finance_predicates:
    "Customer commercial totals use the same Job Charges, invoice, payout, and gross-profit rules as Finance Statistics.",
  quotation_totals_are_not_revenue:
    "Customer quotation totals are not treated as revenue. Only persisted Job Charges count as job charges.",
  currencies_are_not_converted:
    "Amounts in different currencies are never converted or added together.",
  fleet_uses_trip_vehicle_or_fleet_vehicle:
    "Fleet utilisation uses the vehicle recorded on each trip (fleet vehicle when present, otherwise vehicle).",
  trailer_numbers_are_free_text_trip_fields:
    "Trailer/chassis figures use the trailer number recorded on the trip and are not a controlled trailer register.",
};

export function statisticsLimitationNote(code: string): string {
  return STATISTICS_LIMITATION_NOTES[code] ?? code.replaceAll("_", " ");
}

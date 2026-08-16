import { TripStatus } from "@prisma/client";
import { INVOICED_INVOICE_STATUSES } from "../dashboard/dashboard-job-metrics";
import { DEFAULT_DRIVER_EARNING_CURRENCY } from "../transport/drivers/driver-trip-earnings.helpers";

export const COMPLETED_TRIP_STATUSES = [
  TripStatus.COMPLETED,
  TripStatus.DONE,
] as const satisfies readonly TripStatus[];

export const ACTIVE_TRIP_STATUSES = [
  TripStatus.PUBLISHED,
  TripStatus.ONGOING,
] as const satisfies readonly TripStatus[];

export const ISSUED_INVOICE_STATUS = "ISSUED" as const;
export const RECOGNIZED_INVOICE_STATUSES: readonly string[] =
  INVOICED_INVOICE_STATUSES;

export const EXCLUDED_INVOICE_STATUSES = ["DRAFT", "GENERATED", "VOID"] as const;

export const DEFAULT_PAYOUT_CURRENCY = DEFAULT_DRIVER_EARNING_CURRENCY;

/** Product knob used by the future stale-work query. */
export const STALE_WORK_THRESHOLD_HOURS = 72;

/**
 * Product knob for WP5/WP6. Minimum V1 uses Invoice.sourceJobId only.
 */
export const SCAN_INVOICE_SNAPSHOT_SOURCE_JOB_IDS = false;

export const STATISTICS_OVERVIEW_LIMITATIONS = [
  "completed_trips_missing_closed_at_excluded",
  "active_trips_are_current_snapshot",
  "cancelled_trip_date_uses_updated_at",
] as const;

export type StatisticsOverviewLimitation =
  (typeof STATISTICS_OVERVIEW_LIMITATIONS)[number];

export const STATISTICS_EXCEPTION_KEYS = [
  "ex_job_missing_charges",
  "ex_trip_missing_payout",
  "ex_ready_not_invoiced",
  "ex_trip_missing_required_docs",
  "ex_stale_operational_work",
  "ex_cancelled_trip",
  "ex_invalid_timestamps",
  "ex_orphan_invoice_job_link",
  "ex_excluded_from_profit",
] as const;

export type StatisticsExceptionKey =
  (typeof STATISTICS_EXCEPTION_KEYS)[number];

export const STATISTICS_EXCEPTION_SEVERITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
] as const;

export type StatisticsExceptionSeverity =
  (typeof STATISTICS_EXCEPTION_SEVERITIES)[number];

export const STATISTICS_EXCEPTION_SEVERITY_RANK: Record<
  StatisticsExceptionSeverity,
  number
> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

export const STATISTICS_FINANCE_EXCEPTION_KEYS = [
  "ex_job_missing_charges",
  "ex_trip_missing_payout",
  "ex_ready_not_invoiced",
  "ex_orphan_invoice_job_link",
  "ex_excluded_from_profit",
] as const satisfies readonly StatisticsExceptionKey[];

export const STATISTICS_EXCEPTION_DEFINITIONS: Record<
  StatisticsExceptionKey,
  {
    severity: StatisticsExceptionSeverity;
    entityType: "JOB" | "TRIP" | "INVOICE";
    explanation: string;
    resolvableInOpsFlow: boolean;
  }
> = {
  ex_job_missing_charges: {
    severity: "HIGH",
    entityType: "JOB",
    explanation:
      "This job is operationally complete but has no charge lines.",
    resolvableInOpsFlow: true,
  },
  ex_trip_missing_payout: {
    severity: "HIGH",
    entityType: "TRIP",
    explanation: "Completed trip has no selectable payout lines.",
    resolvableInOpsFlow: true,
  },
  ex_ready_not_invoiced: {
    severity: "MEDIUM",
    entityType: "JOB",
    explanation:
      "Job is ready for invoice but no recognized invoice is linked.",
    resolvableInOpsFlow: true,
  },
  ex_trip_missing_required_docs: {
    severity: "MEDIUM",
    entityType: "TRIP",
    explanation: "Required documents for this trip are incomplete.",
    resolvableInOpsFlow: true,
  },
  ex_stale_operational_work: {
    severity: "MEDIUM",
    entityType: "TRIP",
    explanation:
      "This trip has been open longer than the stale threshold.",
    resolvableInOpsFlow: true,
  },
  ex_cancelled_trip: {
    severity: "LOW",
    entityType: "TRIP",
    explanation: "Trip was cancelled.",
    resolvableInOpsFlow: false,
  },
  ex_invalid_timestamps: {
    severity: "MEDIUM",
    entityType: "TRIP",
    explanation:
      "Timestamps are missing or inconsistent; trip is excluded from duration or date cohorts.",
    resolvableInOpsFlow: false,
  },
  ex_orphan_invoice_job_link: {
    severity: "HIGH",
    entityType: "INVOICE",
    explanation:
      "Invoice-job linkage is ambiguous; the invoice may be excluded from job finance rollups.",
    resolvableInOpsFlow: true,
  },
  ex_excluded_from_profit: {
    severity: "LOW",
    entityType: "JOB",
    explanation:
      "Job is excluded from gross profit because revenue or cost is incomplete.",
    resolvableInOpsFlow: true,
  },
};

export const STATISTICS_EXCEPTION_LIMITATIONS = [
  "exceptions_require_transport_and_finance_entitlements",
  "stale_operational_work_is_current_snapshot",
  "closed_at_null_invalid_timestamps_are_current_snapshot",
  "cancelled_trip_date_uses_updated_at",
  "required_document_rules_missing_are_not_confirmed_exceptions",
  "invoice_snapshot_job_linkage_is_partial",
  "charges_and_payout_lines_are_mutable",
] as const;

/**
 * Driver Statistics is Transport-entitled and operational-only.
 * Driver payout values and recordedPayoutCents sorting are deferred to a
 * future Finance-authorized surface; Phase 3 payout-sort expectations are
 * superseded by this authorization boundary.
 */
export const STATISTICS_DRIVER_SORT_FIELDS = [
  "completedTrips",
  "avgDurationMs",
] as const;

export type StatisticsDriverSortField =
  (typeof STATISTICS_DRIVER_SORT_FIELDS)[number];

export const STATISTICS_DRIVER_LIMITATIONS = [
  "active_assignments_are_current_snapshot",
  "cancelled_trip_date_uses_updated_at",
  "reassignment_history_is_partial",
  "required_document_completion_is_partial",
] as const;

export const STATISTICS_DRIVER_ROW_LIMITATIONS = {
  ACTIVE_SNAPSHOT: "active_assignments_are_current_snapshot",
  INVALID_DURATION: "invalid_trip_durations_excluded",
  REASSIGNMENT_PARTIAL: "reassignment_history_is_partial",
  DOCUMENT_RULES_UNAVAILABLE: "required_document_rules_unavailable",
} as const;

export const STATISTICS_FINANCE_LIMITATIONS = [
  "job_charges_are_mutable",
  "published_trip_payouts_are_frozen",
  "payout_currency_assumed_sgd",
  "paid_invoice_date_uses_paid_at",
  "invoice_snapshot_job_links_not_scanned",
  "completed_trips_missing_closed_at_excluded",
] as const;

export const STATISTICS_FINANCE_DYNAMIC_LIMITATIONS = {
  INVALID_CURRENCY: "invalid_currency_records_excluded",
  PROFIT_CURRENCY_MISMATCH: "profit_currency_mismatches_excluded",
  NONPOSITIVE_MARGIN_REVENUE:
    "gross_margin_unavailable_for_nonpositive_eligible_revenue",
} as const;

export const STATISTICS_EXCEPTION_SORT_FIELDS = [
  "severity",
  "reportingTimestamp",
  "key",
] as const;

export type StatisticsExceptionSortField =
  (typeof STATISTICS_EXCEPTION_SORT_FIELDS)[number];

export const STATISTICS_TRUCKING_LIMITATIONS = [
  "container_movement_uses_trip_job_item",
  "trip_container_number_cache_is_not_authoritative",
  "cancelled_trips_are_not_container_movements",
  "cancelled_trip_date_uses_updated_at",
  "container_size_inferred_from_job_item_description",
  "lane_names_use_trip_origin_destination_labels",
  "active_assignments_are_current_snapshot",
  "gps_distance_not_reported",
] as const;

export const STATISTICS_CUSTOMER_LIMITATIONS = [
  "customer_commercial_uses_canonical_finance_predicates",
  "quotation_totals_are_not_revenue",
  "currencies_are_not_converted",
  "payout_currency_assumed_sgd",
  "job_charges_are_mutable",
  "published_trip_payouts_are_frozen",
] as const;

export const STATISTICS_FLEET_LIMITATIONS = [
  "fleet_uses_trip_vehicle_or_fleet_vehicle",
  "trailer_numbers_are_free_text_trip_fields",
  "gps_distance_not_reported",
  "cancelled_trip_date_uses_updated_at",
] as const;

export const STATISTICS_TRUCKING_MOVEMENT_SORT_FIELDS = [
  "movementDate",
  "containerNo",
] as const;

export type StatisticsTruckingMovementSortField =
  (typeof STATISTICS_TRUCKING_MOVEMENT_SORT_FIELDS)[number];

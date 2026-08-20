import { TripExpenseReviewStatus } from "@prisma/client";
import { expenseCountsTowardJobCost } from "./trip-expense.rules";
import { isInvoiceRecognized } from "./invoice-status";
import { DEFAULT_DRIVER_EARNING_CURRENCY } from "../drivers/driver-trip-earnings.helpers";
import {
  resolveCanonicalTripPayoutCents,
  type CanonicalTripPayoutInput,
} from "../trips/trip-payout.helpers";

export const JOB_FINANCE_CURRENCY = DEFAULT_DRIVER_EARNING_CURRENCY;

export const JOB_FINANCE_STATUSES = [
  "NEGATIVE",
  "NON_NEGATIVE",
  "NOT_INVOICED",
] as const;

export type JobFinanceStatus = (typeof JOB_FINANCE_STATUSES)[number];

export type JobFinanceSummary = {
  currency: string;
  driverPayoutCents: number;
  miscPayoutCents: number;
  totalCostCents: number;
  totalJobBillableCents: number;
  invoiceRevenueCents: number | null;
  differenceCents: number | null;
  financeStatus: JobFinanceStatus;
};

export function isApprovedExpenseCost(
  reviewStatus: TripExpenseReviewStatus | string | null | undefined,
): boolean {
  return expenseCountsTowardJobCost({
    reviewStatus: reviewStatus as TripExpenseReviewStatus,
  });
}

export function isRecognizedInvoiceForJobRevenue(
  status: string | null | undefined,
): boolean {
  return isInvoiceRecognized(status);
}

/** Cancelled trips never contribute driver payout. */
export function isTripEligibleForJobDriverPayout(
  status: string | null | undefined,
): boolean {
  return String(status ?? "").toUpperCase() !== "CANCELLED";
}

export function sumDriverPayoutCentsForTrips(
  trips: Array<CanonicalTripPayoutInput & { status?: string | null }>,
): number {
  let total = 0;
  for (const trip of trips) {
    if (!isTripEligibleForJobDriverPayout(trip.status)) continue;
    const cents = resolveCanonicalTripPayoutCents(trip);
    if (cents != null && Number.isInteger(cents) && cents > 0) {
      total += cents;
    }
  }
  return total;
}

/**
 * Canonical finance status:
 * - NOT_INVOICED when no qualifying (ISSUED|PAID) invoice revenue
 * - NEGATIVE only when invoiced and totalCost > invoiceRevenue
 * - NON_NEGATIVE when invoiced and costs do not exceed revenue
 */
export function deriveJobFinanceStatus(input: {
  totalCostCents: number;
  invoiceRevenueCents: number | null;
}): {
  financeStatus: JobFinanceStatus;
  differenceCents: number | null;
} {
  const cost = Math.trunc(Number(input.totalCostCents) || 0);
  if (
    input.invoiceRevenueCents == null ||
    !Number.isInteger(input.invoiceRevenueCents)
  ) {
    return { financeStatus: "NOT_INVOICED", differenceCents: null };
  }
  const revenue = Math.trunc(input.invoiceRevenueCents);
  const differenceCents = cost - revenue;
  if (cost > revenue) {
    return { financeStatus: "NEGATIVE", differenceCents };
  }
  return { financeStatus: "NON_NEGATIVE", differenceCents };
}

export function buildJobFinanceSummary(input: {
  currency?: string;
  driverPayoutCents: number;
  miscPayoutCents: number;
  totalJobBillableCents: number;
  invoiceRevenueCents: number | null;
}): JobFinanceSummary {
  const driverPayoutCents = Math.max(
    0,
    Math.trunc(Number(input.driverPayoutCents) || 0),
  );
  const miscPayoutCents = Math.max(
    0,
    Math.trunc(Number(input.miscPayoutCents) || 0),
  );
  const totalJobBillableCents = Math.max(
    0,
    Math.trunc(Number(input.totalJobBillableCents) || 0),
  );
  const totalCostCents = driverPayoutCents + miscPayoutCents;
  const invoiceRevenueCents =
    input.invoiceRevenueCents == null ||
    !Number.isInteger(input.invoiceRevenueCents)
      ? null
      : Math.max(0, Math.trunc(input.invoiceRevenueCents));
  const derived = deriveJobFinanceStatus({
    totalCostCents,
    invoiceRevenueCents,
  });
  return {
    currency: String(input.currency ?? JOB_FINANCE_CURRENCY)
      .trim()
      .toUpperCase() || JOB_FINANCE_CURRENCY,
    driverPayoutCents,
    miscPayoutCents,
    totalCostCents,
    totalJobBillableCents,
    invoiceRevenueCents,
    differenceCents: derived.differenceCents,
    financeStatus: derived.financeStatus,
  };
}

import { TripDocumentType, TripStatus } from "@prisma/client";
import { evaluateJobInvoiceReadiness } from "../transport/jobs/job-invoice-readiness";
import {
  JobDetailsPayoutLineInput,
  tripPayoutTotalCents,
} from "../transport/jobs/job-details-summary";
import { resolveCanonicalTripPayoutCents } from "../transport/trips/trip-payout.helpers";
import { resolveTripCompletionRule } from "../transport/workflows/job-workflow.helpers";
import {
  ACTIVE_TRIP_STATUSES,
  COMPLETED_TRIP_STATUSES,
  DEFAULT_PAYOUT_CURRENCY,
  STALE_WORK_THRESHOLD_HOURS,
} from "./statistics.constants";

export type StatisticsTripStatusInput = {
  id: string;
  status: TripStatus;
};

export function isCompletedTripStatus(status: TripStatus): boolean {
  return COMPLETED_TRIP_STATUSES.includes(
    status as (typeof COMPLETED_TRIP_STATUSES)[number],
  );
}

export function isActiveTripStatus(status: TripStatus): boolean {
  return ACTIVE_TRIP_STATUSES.includes(
    status as (typeof ACTIVE_TRIP_STATUSES)[number],
  );
}

/**
 * Completed date cohorts require the persisted close timestamp. There is
 * deliberately no updatedAt fallback.
 */
export function completedTripReportingTimestamp(input: {
  status: TripStatus;
  closedAt: Date | null;
}): Date | null {
  return isCompletedTripStatus(input.status) && input.closedAt instanceof Date
    ? input.closedAt
    : null;
}

export type TripDurationResult =
  | { valid: true; durationMs: number }
  | {
      valid: false;
      durationMs: null;
      reason:
        | "missing_started_at"
        | "missing_closed_at"
        | "closed_before_started";
    };

export function resolveTripDuration(input: {
  startedAt: Date | null;
  closedAt: Date | null;
}): TripDurationResult {
  if (!(input.startedAt instanceof Date)) {
    return {
      valid: false,
      durationMs: null,
      reason: "missing_started_at",
    };
  }
  if (!(input.closedAt instanceof Date)) {
    return {
      valid: false,
      durationMs: null,
      reason: "missing_closed_at",
    };
  }
  const durationMs = input.closedAt.getTime() - input.startedAt.getTime();
  if (durationMs < 0) {
    return {
      valid: false,
      durationMs: null,
      reason: "closed_before_started",
    };
  }
  return { valid: true, durationMs };
}

export function isOperationallyCompletedJob(
  trips: StatisticsTripStatusInput[],
): boolean {
  return evaluateJobInvoiceReadiness(trips).readyForInvoice;
}

export function selectableTripPayoutTotalCents(
  payoutLines: JobDetailsPayoutLineInput[] | null | undefined,
): number {
  return tripPayoutTotalCents(payoutLines);
}

export type TripPayoutState =
  | { kind: "recorded"; totalCents: number }
  | { kind: "missing"; totalCents: null };

/**
 * Missing cost stays distinct from a genuine recorded value.
 * Uses the canonical TripPayoutLine resolver (lines first; integer
 * driverEarningCents only when no lines exist).
 */
export function resolveCompletedTripPayoutState(input: {
  status: TripStatus;
  payoutLines?: JobDetailsPayoutLineInput[] | null;
  driverEarningCents?: number | null;
}): TripPayoutState | null {
  if (!isCompletedTripStatus(input.status)) return null;
  const totalCents = resolveCanonicalTripPayoutCents(input);
  return totalCents != null && totalCents > 0
    ? { kind: "recorded", totalCents }
    : { kind: "missing", totalCents: null };
}

export function isCompletedTripMissingPayout(input: {
  status: TripStatus;
  payoutLines?: JobDetailsPayoutLineInput[] | null;
  driverEarningCents?: number | null;
}): boolean {
  return resolveCompletedTripPayoutState(input)?.kind === "missing";
}

export type StatisticsTripDocumentInput = {
  type: TripDocumentType;
  isActive: boolean;
  generatedBySystem?: boolean | null;
  isSigned?: boolean | null;
  signedAt?: Date | null;
};

export type RequiredDocumentCompletionResult = {
  complete: boolean;
  requiredUploadCount: number;
  qualifyingActiveUploadCount: number;
  missingRequiredTypes: TripDocumentType[];
  missingUploadCount: number;
  missingSignedGeneratedDo: boolean;
};

function isSignedDocument(document: StatisticsTripDocumentInput): boolean {
  return document.isSigned === true || document.signedAt instanceof Date;
}

/**
 * Applies the existing completionRuleJson parser, then evaluates only active,
 * explicitly qualifying documents. Unrelated and inactive uploads never
 * improve completion.
 */
export function evaluateRequiredDocumentCompletion(
  completionRuleJson: unknown,
  documents: StatisticsTripDocumentInput[],
): RequiredDocumentCompletionResult {
  const rule = resolveTripCompletionRule(completionRuleJson);
  const activeDocuments = documents.filter((document) => document.isActive);
  const allowedTypes = new Set(rule.allowedUploadTypes);
  const qualifyingActiveUploads = activeDocuments.filter((document) =>
    allowedTypes.has(document.type),
  );
  const presentTypes = new Set(
    qualifyingActiveUploads.map((document) => document.type),
  );
  const missingRequiredTypes = rule.requiredUploadTypesExact.filter(
    (type) => !presentTypes.has(type),
  );
  const missingUploadCount = Math.max(
    0,
    rule.minUploadCount - qualifyingActiveUploads.length,
  );
  const hasSignedGeneratedDo = activeDocuments.some(
    (document) =>
      document.generatedBySystem === true &&
      (document.type === TripDocumentType.PICKUP_DO ||
        document.type === TripDocumentType.DELIVERY_DO) &&
      isSignedDocument(document),
  );
  const missingSignedGeneratedDo =
    rule.requireGeneratedDoSigned && !hasSignedGeneratedDo;

  return {
    complete:
      missingRequiredTypes.length === 0 &&
      missingUploadCount === 0 &&
      !missingSignedGeneratedDo,
    requiredUploadCount: rule.minUploadCount,
    qualifyingActiveUploadCount: qualifyingActiveUploads.length,
    missingRequiredTypes,
    missingUploadCount,
    missingSignedGeneratedDo,
  };
}

export function hasResolvableRequiredDocumentRule(
  completionRuleJson: unknown,
): boolean {
  const rule = resolveTripCompletionRule(completionRuleJson);
  return (
    rule.requireGeneratedDoSigned ||
    rule.minUploadCount > 0 ||
    rule.requiredUploadTypesExact.length > 0
  );
}

export function isInvalidCompletedTripTimestamp(input: {
  status: TripStatus;
  startedAt: Date | null;
  closedAt: Date | null;
}): boolean {
  if (!isCompletedTripStatus(input.status)) return false;
  if (!input.closedAt || !input.startedAt) return true;
  return input.closedAt.getTime() < input.startedAt.getTime();
}

export function isOrphanInvoiceJobLink(input: {
  sourceJobId: string | null;
  sourceJobExistsInTenant: boolean;
  snapshotSourceJobIds?: string[];
  lineSourceJobIds?: Array<string | null>;
}): boolean {
  if (!input.sourceJobId || !input.sourceJobExistsInTenant) return true;
  const relatedJobIds = [
    ...(input.snapshotSourceJobIds ?? []),
    ...(input.lineSourceJobIds ?? []),
  ];
  return relatedJobIds.some(
    (jobId) => !jobId || jobId !== input.sourceJobId,
  );
}

export type CurrencyAmountInput = {
  currency: string;
  amountCents: number;
};

export type CurrencyAmount = {
  currency: string;
  amountCents: number;
};

export function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toUpperCase();
  if (!normalized) throw new TypeError("currency is required");
  return normalized;
}

/**
 * Integer-only currency reducer. The Map key prevents cross-currency sums and
 * the sorted result is deterministic for API responses and tests.
 */
export function groupCurrencyAmounts(
  amounts: CurrencyAmountInput[],
): CurrencyAmount[] {
  const totals = new Map<string, number>();
  for (const amount of amounts) {
    if (!Number.isSafeInteger(amount.amountCents)) {
      throw new TypeError("amountCents must be a safe integer");
    }
    const currency = normalizeCurrency(amount.currency);
    totals.set(currency, (totals.get(currency) ?? 0) + amount.amountCents);
    if (!Number.isSafeInteger(totals.get(currency))) {
      throw new RangeError("currency total exceeds the safe integer range");
    }
  }
  return Array.from(totals, ([currency, amountCents]) => ({
    currency,
    amountCents,
  })).sort((a, b) => a.currency.localeCompare(b.currency));
}

export type GrossProfitEligibilityResult =
  | {
      eligible: true;
      currency: string;
      revenueCents: number;
      payoutCents: number;
      grossProfitCents: number;
    }
  | {
      eligible: false;
      reason:
        | "job_not_operationally_complete"
        | "missing_charges"
        | "missing_trip_payout"
        | "multiple_revenue_currencies"
        | "revenue_payout_currency_mismatch";
    };

export function evaluateGrossProfitEligibility(input: {
  trips: Array<
    StatisticsTripStatusInput & {
      payoutLines?: JobDetailsPayoutLineInput[] | null;
      driverEarningCents?: number | null;
    }
  >;
  charges: CurrencyAmountInput[];
  payoutCurrency?: string;
}): GrossProfitEligibilityResult {
  if (!isOperationallyCompletedJob(input.trips)) {
    return { eligible: false, reason: "job_not_operationally_complete" };
  }
  if (input.charges.length === 0) {
    return { eligible: false, reason: "missing_charges" };
  }

  const completedTrips = input.trips.filter((trip) =>
    isCompletedTripStatus(trip.status),
  );
  const payoutStates = completedTrips.map((trip) =>
    resolveCompletedTripPayoutState(trip),
  );
  if (
    payoutStates.some(
      (state) => state == null || state.kind === "missing",
    )
  ) {
    return { eligible: false, reason: "missing_trip_payout" };
  }

  const revenueGroups = groupCurrencyAmounts(input.charges);
  if (revenueGroups.length !== 1) {
    return { eligible: false, reason: "multiple_revenue_currencies" };
  }
  const payoutCurrency = normalizeCurrency(
    input.payoutCurrency ?? DEFAULT_PAYOUT_CURRENCY,
  );
  if (revenueGroups[0].currency !== payoutCurrency) {
    return {
      eligible: false,
      reason: "revenue_payout_currency_mismatch",
    };
  }

  const payoutCents = payoutStates.reduce(
    (sum, state) =>
      sum + (state?.kind === "recorded" ? state.totalCents : 0),
    0,
  );
  if (!Number.isSafeInteger(payoutCents)) {
    throw new RangeError("payout total exceeds the safe integer range");
  }
  const revenueCents = revenueGroups[0].amountCents;
  const grossProfitCents = revenueCents - payoutCents;
  if (!Number.isSafeInteger(grossProfitCents)) {
    throw new RangeError("gross profit exceeds the safe integer range");
  }

  return {
    eligible: true,
    currency: payoutCurrency,
    revenueCents,
    payoutCents,
    grossProfitCents,
  };
}

/**
 * Calculates integer basis points without floating-point money arithmetic.
 * BigInt prevents overflow in the ×10,000 intermediate. For negative profit,
 * adjust JavaScript's truncation-toward-zero to the approved floor rule.
 */
export function grossMarginBasisPoints(
  grossProfitCents: number,
  revenueCents: number,
): number | null {
  if (
    !Number.isSafeInteger(grossProfitCents) ||
    !Number.isSafeInteger(revenueCents)
  ) {
    throw new TypeError("gross margin inputs must be safe integers");
  }
  if (revenueCents <= 0) return null;
  const numerator = BigInt(grossProfitCents) * 10_000n;
  const denominator = BigInt(revenueCents);
  let quotient = numerator / denominator;
  if (numerator < 0n && numerator % denominator !== 0n) {
    quotient -= 1n;
  }
  const result = Number(quotient);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("gross margin exceeds the safe integer range");
  }
  return result;
}

export function isStaleOperationalTrip(
  input: {
    status: TripStatus;
    plannedStartAt: Date | null;
    updatedAt: Date;
  },
  now: Date,
  thresholdHours = STALE_WORK_THRESHOLD_HOURS,
): boolean {
  if (!isActiveTripStatus(input.status)) return false;
  if (!Number.isFinite(thresholdHours) || thresholdHours < 0) return false;
  const anchor = input.plannedStartAt ?? input.updatedAt;
  const elapsedMs = now.getTime() - anchor.getTime();
  return elapsedMs >= thresholdHours * 60 * 60 * 1000;
}

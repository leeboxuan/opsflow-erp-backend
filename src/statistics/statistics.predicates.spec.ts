import { TripDocumentType, TripStatus } from "@prisma/client";
import {
  EXCLUDED_INVOICE_STATUSES,
  RECOGNIZED_INVOICE_STATUSES,
  STALE_WORK_THRESHOLD_HOURS,
} from "./statistics.constants";
import {
  completedTripReportingTimestamp,
  evaluateGrossProfitEligibility,
  evaluateRequiredDocumentCompletion,
  groupCurrencyAmounts,
  grossMarginBasisPoints,
  hasResolvableRequiredDocumentRule,
  isCompletedTripMissingPayout,
  isCompletedTripStatus,
  isInvalidCompletedTripTimestamp,
  isOperationallyCompletedJob,
  isOrphanInvoiceJobLink,
  isStaleOperationalTrip,
  resolveCompletedTripPayoutState,
  resolveTripDuration,
  selectableTripPayoutTotalCents,
} from "./statistics.predicates";

describe("Statistics V1 canonical predicates", () => {
  describe("trip completion and reporting cohorts", () => {
    it.each([
      [TripStatus.COMPLETED, true],
      [TripStatus.DONE, true],
      [TripStatus.PUBLISHED, false],
      [TripStatus.ONGOING, false],
      [TripStatus.CANCELLED, false],
    ])("classifies %s completed=%s", (status, expected) => {
      expect(isCompletedTripStatus(status)).toBe(expected);
    });

    it("requires closedAt and never falls back to another timestamp", () => {
      expect(
        completedTripReportingTimestamp({
          status: TripStatus.COMPLETED,
          closedAt: new Date("2026-08-01T00:00:00.000Z"),
        }),
      ).toEqual(new Date("2026-08-01T00:00:00.000Z"));
      expect(
        completedTripReportingTimestamp({
          status: TripStatus.COMPLETED,
          closedAt: null,
        }),
      ).toBeNull();
      expect(
        completedTripReportingTimestamp({
          status: TripStatus.ONGOING,
          closedAt: new Date("2026-08-01T00:00:00.000Z"),
        }),
      ).toBeNull();
    });
  });

  describe("duration", () => {
    it.each([
      [
        null,
        new Date("2026-08-01T02:00:00.000Z"),
        { valid: false, durationMs: null, reason: "missing_started_at" },
      ],
      [
        new Date("2026-08-01T01:00:00.000Z"),
        null,
        { valid: false, durationMs: null, reason: "missing_closed_at" },
      ],
      [
        new Date("2026-08-01T01:00:00.000Z"),
        new Date("2026-08-01T01:00:00.000Z"),
        { valid: true, durationMs: 0 },
      ],
      [
        new Date("2026-08-01T01:00:00.000Z"),
        new Date("2026-08-01T02:00:00.000Z"),
        { valid: true, durationMs: 3_600_000 },
      ],
      [
        new Date("2026-08-01T02:00:00.000Z"),
        new Date("2026-08-01T01:00:00.000Z"),
        {
          valid: false,
          durationMs: null,
          reason: "closed_before_started",
        },
      ],
    ])("resolves explicit timestamp validity", (startedAt, closedAt, expected) => {
      expect(resolveTripDuration({ startedAt, closedAt })).toEqual(expected);
    });
  });

  describe("operational job completion", () => {
    it.each([
      [
        [
          { id: "trip-1", status: TripStatus.COMPLETED },
          { id: "trip-2", status: TripStatus.COMPLETED },
        ],
        true,
      ],
      [
        [
          { id: "trip-1", status: TripStatus.COMPLETED },
          { id: "trip-2", status: TripStatus.DONE },
        ],
        true,
      ],
      [
        [
          { id: "trip-1", status: TripStatus.CANCELLED },
          { id: "trip-2", status: TripStatus.DONE },
        ],
        true,
      ],
      [[{ id: "trip-1", status: TripStatus.CANCELLED }], false],
      [
        [
          { id: "trip-1", status: TripStatus.COMPLETED },
          { id: "trip-2", status: TripStatus.ONGOING },
        ],
        false,
      ],
    ])("uses invoice-readiness lifecycle semantics", (trips, expected) => {
      expect(isOperationallyCompletedJob(trips)).toBe(expected);
    });
  });

  describe("payout source of truth", () => {
    const payoutLines = [
      {
        amountCents: 2_000,
        quantity: 2,
        totalCents: null,
        isSelectableForTripEarning: true,
      },
      {
        amountCents: 9_999,
        quantity: 1,
        totalCents: null,
        isSelectableForTripEarning: false,
      },
      {
        amountCents: 1,
        quantity: 1,
        totalCents: 500,
        isSelectableForTripEarning: true,
      },
    ];

    it("aggregates only selectable payout lines through the earnings helper", () => {
      expect(selectableTripPayoutTotalCents(payoutLines)).toBe(4_500);
    });

    it("keeps missing payout distinct from a genuine numeric zero", () => {
      const state = resolveCompletedTripPayoutState({
        status: TripStatus.COMPLETED,
        payoutLines: [
          {
            amountCents: 0,
            totalCents: 0,
            quantity: 1,
            isSelectableForTripEarning: true,
          },
        ],
      });
      expect(state).toEqual({ kind: "missing", totalCents: null });
      expect(
        isCompletedTripMissingPayout({
          status: TripStatus.COMPLETED,
          payoutLines: [],
        }),
      ).toBe(true);
      expect(
        isCompletedTripMissingPayout({
          status: TripStatus.ONGOING,
          payoutLines: [],
        }),
      ).toBe(false);
    });
  });

  describe("currency and gross profit", () => {
    it("groups currencies without cross-summing", () => {
      expect(
        groupCurrencyAmounts([
          { currency: "sgd", amountCents: 1_000 },
          { currency: "USD", amountCents: 2_000 },
          { currency: "SGD", amountCents: 500 },
        ]),
      ).toEqual([
        { currency: "SGD", amountCents: 1_500 },
        { currency: "USD", amountCents: 2_000 },
      ]);
      expect(() =>
        groupCurrencyAmounts([{ currency: "SGD", amountCents: 1.5 }]),
      ).toThrow("amountCents must be a safe integer");
    });

    it("returns profit only for complete jobs with charges and known matching costs", () => {
      expect(
        evaluateGrossProfitEligibility({
          trips: [
            {
              id: "trip-1",
              status: TripStatus.COMPLETED,
              payoutLines: [
                {
                  totalCents: 3_000,
                  isSelectableForTripEarning: true,
                },
              ],
            },
            {
              id: "trip-2",
              status: TripStatus.CANCELLED,
              payoutLines: [],
            },
          ],
          charges: [{ currency: "SGD", amountCents: 10_000 }],
        }),
      ).toEqual({
        eligible: true,
        currency: "SGD",
        revenueCents: 10_000,
        payoutCents: 3_000,
        grossProfitCents: 7_000,
      });
    });

    it.each([
      [
        {
          trips: [
            {
              id: "trip-1",
              status: TripStatus.COMPLETED,
              payoutLines: [],
            },
          ],
          charges: [{ currency: "SGD", amountCents: 10_000 }],
        },
        "missing_trip_payout",
      ],
      [
        {
          trips: [
            {
              id: "trip-1",
              status: TripStatus.DONE,
              payoutLines: [
                {
                  totalCents: 1_000,
                  isSelectableForTripEarning: true,
                },
              ],
            },
          ],
          charges: [{ currency: "USD", amountCents: 10_000 }],
        },
        "revenue_payout_currency_mismatch",
      ],
    ])("preserves ineligibility reason instead of zero", (input, reason) => {
      expect(evaluateGrossProfitEligibility(input)).toEqual({
        eligible: false,
        reason,
      });
    });

    it("calculates margin basis points with integer floor semantics", () => {
      expect(grossMarginBasisPoints(2_500, 10_000)).toBe(2_500);
      expect(grossMarginBasisPoints(-1, 3)).toBe(-3_334);
      expect(grossMarginBasisPoints(1, 0)).toBeNull();
      expect(grossMarginBasisPoints(1, -1)).toBeNull();
      expect(() => grossMarginBasisPoints(1.5, 100)).toThrow(
        "gross margin inputs must be safe integers",
      );
    });
  });

  describe("required documents", () => {
    const rule = {
      requireGeneratedDoSigned: true,
      tripUploads: {
        minUploadCount: 2,
        allowedUploadTypes: [
          TripDocumentType.PICKUP_DO,
          TripDocumentType.POD_SIGNATURE,
        ],
        requiredUploadTypesExact: [
          TripDocumentType.PICKUP_DO,
          TripDocumentType.POD_SIGNATURE,
        ],
      },
    };

    it("counts explicit active requirements and signed generated DO", () => {
      expect(
        evaluateRequiredDocumentCompletion(rule, [
          {
            type: TripDocumentType.PICKUP_DO,
            isActive: true,
            generatedBySystem: true,
            isSigned: true,
          },
          {
            type: TripDocumentType.POD_SIGNATURE,
            isActive: true,
          },
        ]),
      ).toEqual({
        complete: true,
        requiredUploadCount: 2,
        qualifyingActiveUploadCount: 2,
        missingRequiredTypes: [],
        missingUploadCount: 0,
        missingSignedGeneratedDo: false,
      });
    });

    it("excludes inactive and unrelated uploads", () => {
      const result = evaluateRequiredDocumentCompletion(rule, [
        {
          type: TripDocumentType.PICKUP_DO,
          isActive: false,
          generatedBySystem: true,
          isSigned: true,
        },
        {
          type: TripDocumentType.OTHER,
          isActive: true,
        },
      ]);
      expect(result.complete).toBe(false);
      expect(result.qualifyingActiveUploadCount).toBe(0);
      expect(result.missingRequiredTypes).toEqual([
        TripDocumentType.PICKUP_DO,
        TripDocumentType.POD_SIGNATURE,
      ]);
      expect(result.missingSignedGeneratedDo).toBe(true);
    });

    it("distinguishes missing rules from confirmed document requirements", () => {
      expect(hasResolvableRequiredDocumentRule(null)).toBe(false);
      expect(hasResolvableRequiredDocumentRule({})).toBe(false);
      expect(hasResolvableRequiredDocumentRule(rule)).toBe(true);
    });
  });

  describe("exception predicates", () => {
    it.each([
      [TripStatus.COMPLETED, null, null, true],
      [
        TripStatus.DONE,
        new Date("2026-08-01T02:00:00Z"),
        new Date("2026-08-01T01:00:00Z"),
        true,
      ],
      [
        TripStatus.COMPLETED,
        new Date("2026-08-01T01:00:00Z"),
        new Date("2026-08-01T01:00:00Z"),
        false,
      ],
      [TripStatus.ONGOING, null, null, false],
    ])(
      "evaluates invalid completed timestamps",
      (status, startedAt, closedAt, expected) => {
        expect(
          isInvalidCompletedTripTimestamp({
            status,
            startedAt,
            closedAt,
          }),
        ).toBe(expected);
      },
    );

    it("detects missing, cross-tenant, snapshot, and line invoice links", () => {
      expect(
        isOrphanInvoiceJobLink({
          sourceJobId: null,
          sourceJobExistsInTenant: false,
        }),
      ).toBe(true);
      expect(
        isOrphanInvoiceJobLink({
          sourceJobId: "job-1",
          sourceJobExistsInTenant: false,
        }),
      ).toBe(true);
      expect(
        isOrphanInvoiceJobLink({
          sourceJobId: "job-1",
          sourceJobExistsInTenant: true,
          snapshotSourceJobIds: ["job-2"],
        }),
      ).toBe(true);
      expect(
        isOrphanInvoiceJobLink({
          sourceJobId: "job-1",
          sourceJobExistsInTenant: true,
          lineSourceJobIds: [null],
        }),
      ).toBe(true);
      expect(
        isOrphanInvoiceJobLink({
          sourceJobId: "job-1",
          sourceJobExistsInTenant: true,
          snapshotSourceJobIds: ["job-1"],
          lineSourceJobIds: ["job-1"],
        }),
      ).toBe(false);
    });
  });

  describe("stale work", () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    const thresholdMs = STALE_WORK_THRESHOLD_HOURS * 60 * 60 * 1_000;

    it.each([
      [TripStatus.PUBLISHED, thresholdMs - 1, false],
      [TripStatus.PUBLISHED, thresholdMs, true],
      [TripStatus.ONGOING, thresholdMs + 1, true],
      [TripStatus.COMPLETED, thresholdMs + 1, false],
    ])(
      "applies the inclusive threshold boundary for %s",
      (status, ageMs, expected) => {
        expect(
          isStaleOperationalTrip(
            {
              status,
              plannedStartAt: new Date(now.getTime() - ageMs),
              updatedAt: new Date(now.getTime()),
            },
            now,
          ),
        ).toBe(expected);
      },
    );

    it("falls back from plannedStartAt to updatedAt", () => {
      expect(
        isStaleOperationalTrip(
          {
            status: TripStatus.ONGOING,
            plannedStartAt: null,
            updatedAt: new Date(now.getTime() - thresholdMs),
          },
          now,
        ),
      ).toBe(true);
    });
  });

  it("keeps recommended invoice status knobs named and unchanged", () => {
    expect(RECOGNIZED_INVOICE_STATUSES).toEqual(["Sent", "Issued", "Paid"]);
    expect(EXCLUDED_INVOICE_STATUSES).toEqual(["Draft", "Void"]);
  });
});

import { BadRequestException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";
import {
  DRIVER_PAYOUT_LOCKED_AFTER_PUBLISH,
  assertTripPayoutMutable,
  effectivePayoutLineTotalCents,
  isTripPayoutFrozen,
  payoutCacheCentsToPersist,
  resolveCanonicalTripPayoutCents,
  tripPayoutTotalCents,
} from "./trip-payout.helpers";

/** Spec example: 80×1 + 20×2 selectable, 999 non-selectable → 120. */
const CANONICAL_EXAMPLE_LINES = [
  {
    amountCents: 80,
    quantity: 1,
    totalCents: null,
    isSelectableForTripEarning: true,
  },
  {
    amountCents: 20,
    quantity: 2,
    totalCents: null,
    isSelectableForTripEarning: true,
  },
  {
    amountCents: 999,
    quantity: 1,
    totalCents: 999,
    isSelectableForTripEarning: false,
  },
];

describe("canonical Trip payout resolver", () => {
  it("uses totalCents when it is a positive stored total", () => {
    expect(
      effectivePayoutLineTotalCents({
        totalCents: 900,
        amountCents: 100,
        quantity: 2,
      }),
    ).toBe(900);
  });

  it("falls back to amountCents × quantity when totalCents is missing or not positive", () => {
    expect(
      effectivePayoutLineTotalCents({
        totalCents: 0,
        amountCents: 125,
        quantity: 3,
      }),
    ).toBe(375);
    expect(
      effectivePayoutLineTotalCents({
        totalCents: null,
        amountCents: 80,
        quantity: 1,
      }),
    ).toBe(80);
  });

  it("resolves the canonical 80 + 40 example as 120 and excludes non-selectable lines", () => {
    expect(tripPayoutTotalCents(CANONICAL_EXAMPLE_LINES)).toBe(120);
    expect(
      resolveCanonicalTripPayoutCents({
        driverEarningCents: 1119,
        payoutLines: CANONICAL_EXAMPLE_LINES,
      }),
    ).toBe(120);
  });

  it("ignores a stale driverEarningCents cache when payout lines exist", () => {
    expect(
      resolveCanonicalTripPayoutCents({
        driverEarningCents: 50_000,
        payoutLines: CANONICAL_EXAMPLE_LINES,
      }),
    ).toBe(120);
  });

  it("uses integer driverEarningCents only when no payout lines exist", () => {
    expect(
      resolveCanonicalTripPayoutCents({
        driverEarningCents: 7500,
        payoutLines: [],
      }),
    ).toBe(7500);
    expect(
      resolveCanonicalTripPayoutCents({
        driverEarningCents: 7500,
        payoutLines: null,
      }),
    ).toBe(7500);
  });

  it("does not fabricate a payout when both lines and cache are absent", () => {
    expect(
      resolveCanonicalTripPayoutCents({
        driverEarningCents: null,
        payoutLines: [],
      }),
    ).toBeNull();
  });

  it("writes the canonical selectable total into the cache field", () => {
    expect(payoutCacheCentsToPersist(CANONICAL_EXAMPLE_LINES)).toBe(120);
  });

  it("freezes payout after publish for every post-draft status", () => {
    expect(isTripPayoutFrozen(TripStatus.DRAFT)).toBe(false);
    expect(isTripPayoutFrozen(undefined)).toBe(false);
    for (const status of [
      TripStatus.PUBLISHED,
      TripStatus.ONGOING,
      TripStatus.COMPLETED,
      TripStatus.DONE,
      TripStatus.CANCELLED,
    ]) {
      expect(isTripPayoutFrozen(status)).toBe(true);
      expect(() => assertTripPayoutMutable(status)).toThrow(BadRequestException);
      try {
        assertTripPayoutMutable(status);
      } catch (error) {
        expect((error as BadRequestException).message).toBe(
          DRIVER_PAYOUT_LOCKED_AFTER_PUBLISH,
        );
      }
    }
  });
});

import { readFileSync } from "fs";
import { join } from "path";
import {
  TripExpensePaymentMethod,
  TripExpenseReimbursementStatus,
  TripExpenseReviewStatus,
} from "@prisma/client";
import {
  assertClientOperationKey,
  assertReviewTransition,
  assertValidAmountCents,
  expenseCountsTowardJobCost,
  isAllowedExpenseReceiptFile,
  isDriverEditableReviewStatus,
  nextReimbursementStatusOnPaymentMethodChange,
  normalizeIsoCurrency,
  reimbursementStatusForPaymentMethod,
} from "./trip-expense.rules";

describe("trip-expense.rules", () => {
  it("initializes DRIVER_PAID as PENDING reimbursement and company methods as NOT_REQUIRED", () => {
    expect(
      reimbursementStatusForPaymentMethod(TripExpensePaymentMethod.DRIVER_PAID),
    ).toBe(TripExpenseReimbursementStatus.PENDING);
    expect(
      reimbursementStatusForPaymentMethod(
        TripExpensePaymentMethod.COMPANY_EPAYMENT,
      ),
    ).toBe(TripExpenseReimbursementStatus.NOT_REQUIRED);
    expect(
      reimbursementStatusForPaymentMethod(TripExpensePaymentMethod.COMPANY_CASH),
    ).toBe(TripExpenseReimbursementStatus.NOT_REQUIRED);
  });

  it("recalculates reimbursement on payment method change", () => {
    expect(
      nextReimbursementStatusOnPaymentMethodChange(
        TripExpensePaymentMethod.DRIVER_PAID,
        {
          paymentMethod: TripExpensePaymentMethod.COMPANY_CASH,
          reimbursementStatus: TripExpenseReimbursementStatus.NOT_REQUIRED,
        },
      ),
    ).toBe(TripExpenseReimbursementStatus.PENDING);
    expect(
      nextReimbursementStatusOnPaymentMethodChange(
        TripExpensePaymentMethod.COMPANY_EPAYMENT,
        {
          paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
          reimbursementStatus: TripExpenseReimbursementStatus.PAID,
        },
      ),
    ).toBe(TripExpenseReimbursementStatus.NOT_REQUIRED);
  });

  it("only APPROVED expenses count toward job cost; reimbursement never doubles", () => {
    expect(
      expenseCountsTowardJobCost({
        reviewStatus: TripExpenseReviewStatus.APPROVED,
      }),
    ).toBe(true);
    expect(
      expenseCountsTowardJobCost({
        reviewStatus: TripExpenseReviewStatus.PENDING_REVIEW,
      }),
    ).toBe(false);
    expect(
      expenseCountsTowardJobCost({
        reviewStatus: TripExpenseReviewStatus.REJECTED,
      }),
    ).toBe(false);
    expect(
      expenseCountsTowardJobCost({
        reviewStatus: TripExpenseReviewStatus.NEEDS_CLARIFICATION,
      }),
    ).toBe(false);
  });

  it("allows explicit review transitions and rejects silent reopen", () => {
    expect(() =>
      assertReviewTransition(
        TripExpenseReviewStatus.PENDING_REVIEW,
        TripExpenseReviewStatus.APPROVED,
      ),
    ).not.toThrow();
    expect(() =>
      assertReviewTransition(
        TripExpenseReviewStatus.APPROVED,
        TripExpenseReviewStatus.PENDING_REVIEW,
      ),
    ).toThrow(/Invalid expense review transition/);
    expect(() =>
      assertReviewTransition(
        TripExpenseReviewStatus.REJECTED,
        TripExpenseReviewStatus.APPROVED,
      ),
    ).toThrow(/Invalid expense review transition/);
  });

  it("driver may edit only PENDING_REVIEW or NEEDS_CLARIFICATION", () => {
    expect(
      isDriverEditableReviewStatus(TripExpenseReviewStatus.PENDING_REVIEW),
    ).toBe(true);
    expect(
      isDriverEditableReviewStatus(TripExpenseReviewStatus.NEEDS_CLARIFICATION),
    ).toBe(true);
    expect(isDriverEditableReviewStatus(TripExpenseReviewStatus.APPROVED)).toBe(
      false,
    );
    expect(isDriverEditableReviewStatus(TripExpenseReviewStatus.REJECTED)).toBe(
      false,
    );
  });

  it("validates amount cents and SGD currency", () => {
    expect(assertValidAmountCents(1)).toBe(1);
    expect(() => assertValidAmountCents(0)).toThrow();
    expect(() => assertValidAmountCents(-5)).toThrow();
    expect(() => assertValidAmountCents(1.5)).toThrow();
    expect(normalizeIsoCurrency("sgd")).toBe("SGD");
    expect(() => normalizeIsoCurrency("USD")).toThrow(/Unsupported/);
  });

  it("validates receipt MIME+extension together", () => {
    expect(
      isAllowedExpenseReceiptFile({
        mimeType: "image/jpeg",
        originalName: "r.jpg",
        sizeBytes: 100,
      }).ok,
    ).toBe(true);
    expect(
      isAllowedExpenseReceiptFile({
        mimeType: "application/pdf",
        originalName: "r.pdf",
        sizeBytes: 100,
      }).ok,
    ).toBe(true);
    expect(
      isAllowedExpenseReceiptFile({
        mimeType: "application/pdf",
        originalName: "spoof.jpg",
        sizeBytes: 100,
      }).ok,
    ).toBe(false);
    expect(
      isAllowedExpenseReceiptFile({
        mimeType: "text/plain",
        originalName: "r.txt",
        sizeBytes: 100,
      }).ok,
    ).toBe(false);
  });

  it("phase2 migration is additive and preflight is read-only", () => {
    const root = join(__dirname, "../../../prisma/migrations/20260820190000_trip_expenses");
    const migration = readFileSync(join(root, "migration.sql"), "utf8");
    const preflight = readFileSync(join(root, "preflight.sql"), "utf8");
    expect(migration).toContain('CREATE TABLE "trip_expenses"');
    expect(migration).toContain('CREATE TABLE "trip_expense_attachments"');
    expect(migration).toContain('CREATE TABLE "trip_expense_events"');
    expect(migration).not.toMatch(/\bDROP TABLE\b/i);
    expect(preflight).toMatch(/SELECT 1/);
    expect(preflight).not.toMatch(/\b(UPDATE|INSERT|DELETE|ALTER|DROP)\b/i);
  });

  it("requires high-entropy client operation keys (not business-field fallbacks)", () => {
    expect(assertClientOperationKey("11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(() => assertClientOperationKey("")).toThrow(/required/i);
    expect(() => assertClientOperationKey("short")).toThrow(/16/);
    expect(() => assertClientOperationKey("bad key with spaces!!!!")).toThrow(
      /malformed/i,
    );
  });
});

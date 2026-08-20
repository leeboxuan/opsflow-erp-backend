import {
  TripExpensePaymentMethod,
  TripExpenseReimbursementStatus,
  TripExpenseReviewStatus,
} from "@prisma/client";

/** Max single expense in cents (SGD 100,000.00). */
export const TRIP_EXPENSE_MAX_AMOUNT_CENTS = 10_000_000;

export const TRIP_EXPENSE_ALLOWED_CURRENCIES = new Set(["SGD"]);

export const TRIP_EXPENSE_RECEIPT_MAX_BYTES = 12 * 1024 * 1024;

export const TRIP_EXPENSE_RECEIPT_MIME_ALLOWLIST = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];
const PDF_EXT = [".pdf"];

export function reimbursementStatusForPaymentMethod(
  method: TripExpensePaymentMethod,
): TripExpenseReimbursementStatus {
  if (method === TripExpensePaymentMethod.DRIVER_PAID) {
    return TripExpenseReimbursementStatus.PENDING;
  }
  return TripExpenseReimbursementStatus.NOT_REQUIRED;
}

/**
 * When payment method changes on an editable expense:
 * - DRIVER_PAID → PENDING (unless already PAID and still DRIVER_PAID — not applicable on change away)
 * - Leaving DRIVER_PAID → NOT_REQUIRED and clear paid timestamps via caller
 */
export function nextReimbursementStatusOnPaymentMethodChange(
  nextMethod: TripExpensePaymentMethod,
  previous: {
    paymentMethod: TripExpensePaymentMethod;
    reimbursementStatus: TripExpenseReimbursementStatus;
  },
): TripExpenseReimbursementStatus {
  if (nextMethod === TripExpensePaymentMethod.DRIVER_PAID) {
    if (
      previous.paymentMethod === TripExpensePaymentMethod.DRIVER_PAID &&
      previous.reimbursementStatus === TripExpenseReimbursementStatus.PAID
    ) {
      return TripExpenseReimbursementStatus.PAID;
    }
    return TripExpenseReimbursementStatus.PENDING;
  }
  return TripExpenseReimbursementStatus.NOT_REQUIRED;
}

/** Phase 2: all categories require ≥1 active receipt for approval. */
export function expenseCategoryRequiresReceipt(_category: string): boolean {
  return true;
}

export function isDriverEditableReviewStatus(
  status: TripExpenseReviewStatus,
): boolean {
  return (
    status === TripExpenseReviewStatus.PENDING_REVIEW ||
    status === TripExpenseReviewStatus.NEEDS_CLARIFICATION
  );
}

export type TripExpenseReviewTransition =
  | { from: TripExpenseReviewStatus; to: TripExpenseReviewStatus; action: string };

export function assertReviewTransition(
  from: TripExpenseReviewStatus,
  to: TripExpenseReviewStatus,
): void {
  const allowed: Array<[TripExpenseReviewStatus, TripExpenseReviewStatus]> = [
    [TripExpenseReviewStatus.PENDING_REVIEW, TripExpenseReviewStatus.APPROVED],
    [TripExpenseReviewStatus.PENDING_REVIEW, TripExpenseReviewStatus.REJECTED],
    [
      TripExpenseReviewStatus.PENDING_REVIEW,
      TripExpenseReviewStatus.NEEDS_CLARIFICATION,
    ],
    [
      TripExpenseReviewStatus.NEEDS_CLARIFICATION,
      TripExpenseReviewStatus.PENDING_REVIEW,
    ],
  ];
  const ok = allowed.some(([a, b]) => a === from && b === to);
  if (!ok) {
    throw new Error(`Invalid expense review transition ${from} → ${to}`);
  }
}

export function normalizeIsoCurrency(raw: unknown): string {
  const code = String(raw ?? "SGD")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error("Currency must be a 3-letter ISO code");
  }
  if (!TRIP_EXPENSE_ALLOWED_CURRENCIES.has(code)) {
    throw new Error(`Unsupported currency: ${code}`);
  }
  return code;
}

export function assertValidAmountCents(amountCents: unknown): number {
  if (
    typeof amountCents !== "number" ||
    !Number.isInteger(amountCents) ||
    !Number.isSafeInteger(amountCents)
  ) {
    throw new Error("amountCents must be a safe integer");
  }
  if (amountCents <= 0) {
    throw new Error("amountCents must be greater than zero");
  }
  if (amountCents > TRIP_EXPENSE_MAX_AMOUNT_CENTS) {
    throw new Error("amountCents exceeds maximum allowed");
  }
  return amountCents;
}

export function isAllowedExpenseReceiptFile(input: {
  mimeType?: string | null;
  originalName?: string | null;
  sizeBytes?: number | null;
}): { ok: true } | { ok: false; reason: string } {
  const mime = String(input.mimeType ?? "")
    .trim()
    .toLowerCase();
  const name = String(input.originalName ?? "")
    .trim()
    .toLowerCase();
  const size = input.sizeBytes == null ? null : Number(input.sizeBytes);

  if (size != null && (!Number.isFinite(size) || size <= 0)) {
    return { ok: false, reason: "Invalid file size" };
  }
  if (size != null && size > TRIP_EXPENSE_RECEIPT_MAX_BYTES) {
    return { ok: false, reason: "Receipt exceeds maximum size" };
  }

  const extOk =
    IMAGE_EXT.some((ext) => name.endsWith(ext)) ||
    PDF_EXT.some((ext) => name.endsWith(ext));

  if (!TRIP_EXPENSE_RECEIPT_MIME_ALLOWLIST.has(mime)) {
    return { ok: false, reason: "Unsupported receipt MIME type" };
  }
  if (!extOk) {
    return { ok: false, reason: "Unsupported receipt file extension" };
  }

  if (mime === "application/pdf" && !name.endsWith(".pdf")) {
    return { ok: false, reason: "PDF MIME requires .pdf extension" };
  }
  if (mime.startsWith("image/") && !IMAGE_EXT.some((ext) => name.endsWith(ext))) {
    return { ok: false, reason: "Image MIME requires an image extension" };
  }

  return { ok: true };
}

/** Counts toward future job cost: APPROVED only. Reimbursement status never doubles cost. */
export function expenseCountsTowardJobCost(input: {
  reviewStatus: TripExpenseReviewStatus;
}): boolean {
  return input.reviewStatus === TripExpenseReviewStatus.APPROVED;
}

/**
 * Client-generated idempotency operation key.
 * Must be high-entropy (UUID or equivalent); never derived from business fields.
 */
export function assertClientOperationKey(raw: unknown): string {
  const key = String(raw ?? "").trim();
  if (!key) {
    throw new Error("operationKey is required");
  }
  if (key.length < 16 || key.length > 128) {
    throw new Error("operationKey must be 16–128 characters");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(key)) {
    throw new Error("operationKey is malformed");
  }
  return key;
}

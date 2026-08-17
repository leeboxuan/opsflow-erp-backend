import { createHash } from "crypto";

/** Stable JSON stringify for request-hash comparison. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function hashRequestPayload(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export const IDEMPOTENCY_SCOPES = {
  CUSTOMER_ONBOARDING: "CUSTOMER_ONBOARDING",
  CUSTOMER_FIRST_QUOTATION: "CUSTOMER_FIRST_QUOTATION",
  CUSTOMER_FIRST_QUOTATION_LINES: "CUSTOMER_FIRST_QUOTATION_LINES",
} as const;

export type IdempotencyScope =
  (typeof IDEMPOTENCY_SCOPES)[keyof typeof IDEMPOTENCY_SCOPES];

export function isUniqueConstraintError(
  error: unknown,
  target?: string,
): boolean {
  const code = (error as { code?: string })?.code;
  if (code !== "P2002") return false;
  if (!target) return true;
  const meta = (error as { meta?: { target?: string[] | string } })?.meta;
  const constraintTarget = meta?.target;
  if (Array.isArray(constraintTarget)) {
    return constraintTarget.includes(target);
  }
  return String(constraintTarget ?? "").includes(target);
}

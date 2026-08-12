import crypto from "crypto";
import type { JobMessageImportMovementType, JobMessageImportSourceChannel } from "@prisma/client";
import type { ControllerReviewedDraft } from "./job-message-import.types";

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function normalizeForFingerprint(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizeItemCode(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, "").trim().toUpperCase();
}

export function reviewedItemCodes(reviewed: ControllerReviewedDraft): string[] {
  const codes = reviewed.items
    .map((it) => normalizeItemCode(it.containerNumber || it.referenceNumber))
    .filter((code) => code.length > 0);
  return Array.from(new Set(codes)).sort();
}

/**
 * Accidental double-submit protection for preview.
 * Does not permanently block re-import after a prior batch is confirmed.
 */
export function computeBatchFingerprint(input: {
  tenantId: string;
  sourceChannel: JobMessageImportSourceChannel | string;
  timezone: string;
  sourceText: string;
  parserVersion: string;
}): string {
  const normalized = input.sourceText.replace(/\s+/g, " ").trim();
  return sha256Hex(
    [
      input.tenantId,
      input.sourceChannel,
      input.timezone,
      input.parserVersion,
      normalized,
    ].join("~"),
  );
}

/**
 * Strongest practical V1 fingerprint: tenant + movement + requested planning date + item codes
 * + normalized pickup/delivery. Skips weak/absent customer names.
 */
export function computeDraftFingerprint(input: {
  tenantId: string;
  movementType: JobMessageImportMovementType | string;
  reviewed: ControllerReviewedDraft;
}): string {
  const itemCodes = reviewedItemCodes(input.reviewed);
  const planningDate =
    input.reviewed.pickupDateLocal?.slice(0, 10) ??
    input.reviewed.deliveryDateLocal?.slice(0, 10) ??
    "";
  const parts = [
    input.tenantId,
    String(input.movementType),
    planningDate,
    input.reviewed.customerCompanyId ?? "",
    normalizeForFingerprint(input.reviewed.pickupAddress1),
    normalizeForFingerprint(input.reviewed.deliveryAddress1),
    itemCodes.join(","),
  ];
  return sha256Hex(parts.join("~"));
}

export function fingerprintHasStrongIdentity(reviewed: ControllerReviewedDraft): boolean {
  return reviewedItemCodes(reviewed).length > 0;
}

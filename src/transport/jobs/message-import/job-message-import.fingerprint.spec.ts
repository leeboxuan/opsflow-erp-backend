import { JobMessageImportMovementType } from "@prisma/client";
import {
  computeBatchFingerprint,
  computeDraftFingerprint,
  fingerprintHasStrongIdentity,
} from "./job-message-import.fingerprint";
import { normalizeReviewedDraft } from "./job-message-import.validator";

const reviewed = normalizeReviewedDraft({
  movementType: JobMessageImportMovementType.IMPORT,
  customerCompanyId: "c1",
  pickupAddress1: "Tuas",
  deliveryAddress1: "DB",
  pickupDateLocal: "2026-08-12T09:00",
  items: [{ containerNumber: "GESU6311344", sealNumber: null, referenceNumber: null, quantity: 1 }],
});

describe("job-message-import fingerprints", () => {
  it("batch fingerprint is stable for the same source text", () => {
    const a = computeBatchFingerprint({
      tenantId: "t1",
      sourceChannel: "WHATSAPP",
      timezone: "Asia/Singapore",
      sourceText: "hello",
      parserVersion: "v1",
    });
    const b = computeBatchFingerprint({
      tenantId: "t1",
      sourceChannel: "WHATSAPP",
      timezone: "Asia/Singapore",
      sourceText: "hello",
      parserVersion: "v1",
    });
    expect(a).toBe(b);
  });

  it("normalizes whitespace in source text", () => {
    const a = computeBatchFingerprint({
      tenantId: "t1",
      sourceChannel: "WHATSAPP",
      timezone: "Asia/Singapore",
      sourceText: "hello   world",
      parserVersion: "v1",
    });
    const b = computeBatchFingerprint({
      tenantId: "t1",
      sourceChannel: "WHATSAPP",
      timezone: "Asia/Singapore",
      sourceText: "hello world",
      parserVersion: "v1",
    });
    expect(a).toBe(b);
  });

  it("draft fingerprint changes when container or pickup changes", () => {
    const a = computeDraftFingerprint({
      tenantId: "t1",
      movementType: JobMessageImportMovementType.IMPORT,
      reviewed,
    });
    const b = computeDraftFingerprint({
      tenantId: "t1",
      movementType: JobMessageImportMovementType.IMPORT,
      reviewed: { ...reviewed, pickupAddress1: "PPZ" },
    });
    expect(a).not.toBe(b);
    expect(fingerprintHasStrongIdentity(reviewed)).toBe(true);
    expect(fingerprintHasStrongIdentity({ ...reviewed, items: [] })).toBe(false);
  });

  it("draft fingerprint includes requested planning date when present", () => {
    const a = computeDraftFingerprint({
      tenantId: "t1",
      movementType: JobMessageImportMovementType.IMPORT,
      reviewed,
    });
    const b = computeDraftFingerprint({
      tenantId: "t1",
      movementType: JobMessageImportMovementType.IMPORT,
      reviewed: { ...reviewed, pickupDateLocal: "2026-08-13T09:00" },
    });
    expect(a).not.toBe(b);
  });
});

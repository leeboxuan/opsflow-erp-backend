import { TripDocumentType } from "@prisma/client";

export const SIGNABLE_DO_TYPES = [
  TripDocumentType.PICKUP_DO,
  TripDocumentType.DELIVERY_DO,
] as const;

export type SignableDoType = (typeof SIGNABLE_DO_TYPES)[number];

/** Active trip document types that may hold a signature image artifact. */
export const SIGNATURE_ARTIFACT_TYPES: TripDocumentType[] = [
  TripDocumentType.PICKUP_SIGNATURE,
  TripDocumentType.DELIVERY_SIGNATURE,
  TripDocumentType.POD_SIGNATURE,
  TripDocumentType.SIGNATURE,
];

export type SignableDoDocument = {
  type: string;
  isSigned?: boolean | null;
  signedAt?: Date | null;
  signedByName?: string | null;
  storageKey?: string | null;
  createdAt?: Date;
};

export type SignableDoJob = {
  receiverName?: string | null;
  podRecipientName?: string | null;
  pickupContactName?: string | null;
};

export type DoSignatureEmbedInput = {
  signatureImageBytes: Buffer | null;
  recipientName: string | null;
  recipientNric: string | null;
  signedAt: Date | null;
};

export type SignTripDocumentBody = {
  signedByName?: string | null;
  signedAt?: string | Date | null;
  signatureBase64?: string | null;
  signatureImage?: string | null;
  signatureContentType?: string | null;
  documentType?: string | null;
};

export type DoSignatureImageSource =
  | "inline_request"
  | "stored_signature_document"
  | "legacy_pod_signature"
  | "none";

export function isSignableDoType(type: string): type is SignableDoType {
  return SIGNABLE_DO_TYPES.includes(type as SignableDoType);
}

export function signatureArtifactTypeForDo(
  doType: SignableDoType,
): TripDocumentType {
  return doType === TripDocumentType.PICKUP_DO
    ? TripDocumentType.PICKUP_SIGNATURE
    : TripDocumentType.DELIVERY_SIGNATURE;
}

/** Priority order when resolving a stored signature image for PDF embed. */
export function signatureArtifactFallbackTypes(
  doType: SignableDoType,
): TripDocumentType[] {
  if (doType === TripDocumentType.PICKUP_DO) {
    return [TripDocumentType.PICKUP_SIGNATURE, TripDocumentType.SIGNATURE];
  }
  return [
    TripDocumentType.DELIVERY_SIGNATURE,
    TripDocumentType.POD_SIGNATURE,
    TripDocumentType.SIGNATURE,
  ];
}

export function pickPreferredSignatureArtifact<
  T extends { type: string; storageKey?: string | null },
>(artifacts: T[], doType: SignableDoType): T | null {
  for (const preferredType of signatureArtifactFallbackTypes(doType)) {
    const match = artifacts.find(
      (artifact) => artifact.type === preferredType && artifact.storageKey,
    );
    if (match) return match;
  }
  return null;
}

export function doStorageFolderForType(doType: SignableDoType): string {
  return doType === TripDocumentType.PICKUP_DO ? "pickup-do" : "delivery-do";
}

export function doFileSuffixForType(doType: SignableDoType): string {
  return doType === TripDocumentType.PICKUP_DO ? "pickup-do" : "delivery-do";
}

export function buildSignedDoSignatureStorageKey(
  tenantId: string,
  jobId: string,
  tripId: string,
  doType: SignableDoType,
  mimeType: string,
  timestampMs: number = Date.now(),
): string {
  const ext =
    mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
  return `${tenantId}/jobs/${jobId}/trips/${tripId}/signatures/${doType}/${timestampMs}-signature.${ext}`;
}

export function signableDoHasCustomerSignature(
  doType: SignableDoType,
  doDoc: SignableDoDocument | null | undefined,
  signatureArtifact: SignableDoDocument | null | undefined,
  overrides?: Partial<DoSignatureEmbedInput>,
): boolean {
  if (overrides?.signatureImageBytes?.length) return true;
  if (!doDoc) return false;
  if (!!doDoc.signedAt || doDoc.isSigned === true) return true;
  if (signatureArtifact?.storageKey) {
    const allowed = signatureArtifactFallbackTypes(doType);
    if (allowed.includes(signatureArtifact.type as TripDocumentType)) {
      return true;
    }
  }
  return false;
}

export function resolveSignerNameForDo(
  doType: SignableDoType,
  doDoc: SignableDoDocument | null | undefined,
  job: SignableDoJob,
  overrideName?: string | null,
): string | null {
  const fromOverride = overrideName?.trim();
  if (fromOverride) return fromOverride;
  const fromDo = doDoc?.signedByName?.trim();
  if (fromDo) return fromDo;
  if (doType === TripDocumentType.PICKUP_DO) {
    return job.pickupContactName?.trim() || null;
  }
  return job.podRecipientName?.trim() || job.receiverName?.trim() || null;
}

export function resolveDoSignatureEmbedInput(
  doType: SignableDoType,
  doDoc: SignableDoDocument | null | undefined,
  signatureArtifact: SignableDoDocument | null | undefined,
  job: SignableDoJob,
  overrides?: Partial<DoSignatureEmbedInput>,
): DoSignatureEmbedInput | null {
  if (!signableDoHasCustomerSignature(doType, doDoc, signatureArtifact, overrides)) {
    return null;
  }

  const recipientName = resolveSignerNameForDo(
    doType,
    doDoc,
    job,
    overrides?.recipientName,
  );

  const signedAt =
    overrides?.signedAt
    ?? doDoc?.signedAt
    ?? signatureArtifact?.signedAt
    ?? signatureArtifact?.createdAt
    ?? null;

  return {
    signatureImageBytes: overrides?.signatureImageBytes ?? null,
    recipientName,
    recipientNric: overrides?.recipientNric?.trim() || null,
    signedAt,
  };
}

export function parseSignatureImageBytes(
  input?: SignTripDocumentBody | null,
): Buffer | null {
  if (!input) return null;

  const rawBase64 = String(input.signatureBase64 ?? "").trim();
  if (rawBase64) {
    const cleaned = rawBase64.replace(/^data:image\/[a-z0-9+.-]+;base64,/i, "");
    try {
      const buf = Buffer.from(cleaned, "base64");
      return buf.length > 0 ? buf : null;
    } catch {
      return null;
    }
  }

  const dataUrl = String(input.signatureImage ?? "").trim();
  if (dataUrl.startsWith("data:")) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
    if (match?.[2]) {
      try {
        const buf = Buffer.from(match[2], "base64");
        return buf.length > 0 ? buf : null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function parseSignatureContentType(
  input?: SignTripDocumentBody | null,
): string {
  const fromBody = String(input?.signatureContentType ?? "").trim();
  if (fromBody) return fromBody;

  const dataUrl = String(input?.signatureImage ?? "").trim();
  if (dataUrl.startsWith("data:")) {
    const match = dataUrl.match(/^data:([^;]+);base64,/i);
    if (match?.[1]) return match[1];
  }

  return "image/png";
}

export function parseSignedAtFromBody(
  input?: SignTripDocumentBody | null,
): Date | null {
  if (!input?.signedAt) return null;
  const d =
    input.signedAt instanceof Date
      ? input.signedAt
      : new Date(String(input.signedAt));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isDoSignatureDebugEnabled(): boolean {
  const flag = String(process.env.DO_SIGNATURE_DEBUG ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export function logDoSignatureDebug(payload: Record<string, unknown>): void {
  if (!isDoSignatureDebugEnabled()) return;
  console.info("do_signature_debug", payload);
}

export function warnMissingSignatureImageForSignedDo(
  doType: SignableDoType,
  doDoc: SignableDoDocument | null | undefined,
): void {
  const hasSignedMeta =
    !!doDoc?.signedAt || doDoc?.isSigned === true;
  if (!hasSignedMeta) return;
  console.warn(
    "Signed metadata exists but no signature image found; cannot embed handwritten signature.",
    { doType, tripDocumentType: doDoc?.type ?? null },
  );
}

export function resolveUsedSignatureSource(
  inlineBytes: Buffer | null | undefined,
  storedArtifact: SignableDoDocument | null | undefined,
  downloadedBytes: Buffer | null | undefined,
): DoSignatureImageSource {
  if (inlineBytes?.length) return "inline_request";
  if (storedArtifact?.storageKey && downloadedBytes?.length) {
    if (
      storedArtifact.type === TripDocumentType.POD_SIGNATURE
      || storedArtifact.type === TripDocumentType.SIGNATURE
    ) {
      return "legacy_pod_signature";
    }
    return "stored_signature_document";
  }
  return "none";
}

/** @deprecated Use signableDoHasCustomerSignature */
export function deliveryDoHasCustomerSignature(
  deliveryDo: SignableDoDocument | null | undefined,
  podSignature: SignableDoDocument | null | undefined,
  overrides?: Partial<DoSignatureEmbedInput>,
): boolean {
  return signableDoHasCustomerSignature(
    TripDocumentType.DELIVERY_DO,
    deliveryDo,
    podSignature,
    overrides,
  );
}

/** @deprecated Use resolveDoSignatureEmbedInput */
export function resolveDeliveryDoSignatureEmbedInput(
  deliveryDo: SignableDoDocument | null | undefined,
  podSignature: SignableDoDocument | null | undefined,
  job: SignableDoJob,
  overrides?: Partial<DoSignatureEmbedInput>,
): DoSignatureEmbedInput | null {
  return resolveDoSignatureEmbedInput(
    TripDocumentType.DELIVERY_DO,
    deliveryDo,
    podSignature,
    job,
    overrides,
  );
}

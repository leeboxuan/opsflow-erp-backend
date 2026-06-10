import { TripDocumentType } from "@prisma/client";

export const SIGNABLE_DO_TYPES = [
  TripDocumentType.PICKUP_DO,
  TripDocumentType.DELIVERY_DO,
] as const;

export type SignableDoType = (typeof SIGNABLE_DO_TYPES)[number];

/** Active trip document types that may hold a signature image artifact. */
export const SIGNATURE_ARTIFACT_TYPES: TripDocumentType[] = [
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

export function isSignableDoType(type: string): type is SignableDoType {
  return SIGNABLE_DO_TYPES.includes(type as SignableDoType);
}

export function doStorageFolderForType(doType: SignableDoType): string {
  return doType === TripDocumentType.PICKUP_DO ? "pickup-do" : "delivery-do";
}

export function doFileSuffixForType(doType: SignableDoType): string {
  return doType === TripDocumentType.PICKUP_DO ? "pickup-do" : "delivery-do";
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
  // Delivery DO may be satisfied by a separate POD_SIGNATURE upload.
  if (
    doType === TripDocumentType.DELIVERY_DO
    && signatureArtifact?.storageKey
  ) {
    return true;
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

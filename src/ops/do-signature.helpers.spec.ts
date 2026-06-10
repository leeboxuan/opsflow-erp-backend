import { TripDocumentType } from "@prisma/client";
import {
  buildSignedDoSignatureStorageKey,
  parseSignatureContentType,
  parseSignatureImageBytes,
  parseSignedAtFromBody,
  pickPreferredSignatureArtifact,
  resolveDoSignatureEmbedInput,
  resolveSignerNameForDo,
  signableDoHasCustomerSignature,
} from "./do-signature.helpers";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("do-signature.helpers", () => {
  const deliveryJob = {
    receiverName: "Delivery Receiver",
    pickupContactName: "Pickup Shipper",
  };

  it("detects signature from signed DO metadata or delivery POD_SIGNATURE artifact", () => {
    expect(
      signableDoHasCustomerSignature(
        TripDocumentType.DELIVERY_DO,
        { type: TripDocumentType.DELIVERY_DO, isSigned: true },
        null,
      ),
    ).toBe(true);
    expect(
      signableDoHasCustomerSignature(
        TripDocumentType.DELIVERY_DO,
        { type: TripDocumentType.DELIVERY_DO, isSigned: false },
        {
          type: TripDocumentType.POD_SIGNATURE,
          storageKey: "sig.png",
        },
      ),
    ).toBe(true);
    expect(
      signableDoHasCustomerSignature(
        TripDocumentType.PICKUP_DO,
        { type: TripDocumentType.PICKUP_DO, isSigned: false },
        {
          type: TripDocumentType.PICKUP_SIGNATURE,
          storageKey: "sig.png",
        },
      ),
    ).toBe(true);
    expect(
      signableDoHasCustomerSignature(
        TripDocumentType.PICKUP_DO,
        null,
        {
          type: TripDocumentType.POD_SIGNATURE,
          storageKey: "sig.png",
        },
      ),
    ).toBe(false);
  });

  it("prefers DELIVERY_SIGNATURE over POD_SIGNATURE for delivery DO", () => {
    const picked = pickPreferredSignatureArtifact(
      [
        {
          type: TripDocumentType.POD_SIGNATURE,
          storageKey: "pod.png",
        },
        {
          type: TripDocumentType.DELIVERY_SIGNATURE,
          storageKey: "delivery.png",
        },
      ],
      TripDocumentType.DELIVERY_DO,
    );
    expect(picked?.type).toBe(TripDocumentType.DELIVERY_SIGNATURE);
  });

  it("builds signature storage key under signatures/{doType}/", () => {
    expect(
      buildSignedDoSignatureStorageKey(
        "t1",
        "j1",
        "trip1",
        TripDocumentType.PICKUP_DO,
        "image/png",
        1781052623000,
      ),
    ).toBe("t1/jobs/j1/trips/trip1/signatures/PICKUP_DO/1781052623000-signature.png");
  });

  it("parses signatureContentType from data URL", () => {
    expect(
      parseSignatureContentType({
        signatureImage: `data:image/jpeg;base64,${TINY_PNG_BASE64}`,
      }),
    ).toBe("image/jpeg");
  });

  it("uses pickupContactName for pickup DO signer fallback", () => {
    expect(
      resolveSignerNameForDo(
        TripDocumentType.PICKUP_DO,
        { type: TripDocumentType.PICKUP_DO, signedByName: null },
        deliveryJob,
      ),
    ).toBe("Pickup Shipper");
  });

  it("uses signedByName for delivery DO embed input", () => {
    const input = resolveDoSignatureEmbedInput(
      TripDocumentType.DELIVERY_DO,
      {
        type: TripDocumentType.DELIVERY_DO,
        isSigned: true,
        signedByName: "Derek",
        signedAt: new Date("2026-06-10T00:30:00.000Z"),
      },
      null,
      deliveryJob,
    );
    expect(input?.recipientName).toBe("Derek");
  });

  it("parses signatureBase64 from mobile body", () => {
    const buf = parseSignatureImageBytes({ signatureBase64: TINY_PNG_BASE64 });
    expect(buf?.length).toBeGreaterThan(0);
  });

  it("parses signatureImage data URL from mobile body", () => {
    const buf = parseSignatureImageBytes({
      signatureImage: `data:image/png;base64,${TINY_PNG_BASE64}`,
    });
    expect(buf?.length).toBeGreaterThan(0);
  });

  it("parses signedAt ISO string from mobile body", () => {
    const d = parseSignedAtFromBody({ signedAt: "2026-06-10T00:30:00.000Z" });
    expect(d?.toISOString()).toBe("2026-06-10T00:30:00.000Z");
  });
});

import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { JobMessageImportConfirmRequestDto } from "../dto/job-message-import-confirm.dto";

/**
 * API-boundary contract for POST /jobs/message-imports/:batchId/confirm.
 * Uses the same ValidationPipe options as production (main.ts).
 */
describe("JobMessageImportConfirmRequestDto ValidationPipe", () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  const legitimateWritableDraft = {
    draftId: "draft_1",
    movementType: "COLLECTION",
    collectionType: "EMPTY",
    customerCompanyId: "comp_1",
    customerNameText: null,
    pickupAddress1: "30 Pioneer Sector 2",
    pickupAddress2: null,
    pickupPostal: "628386",
    pickupPlaceId: "ChIJ-pickup",
    pickupLat: 1.3,
    pickupLng: 103.6,
    deliveryAddress1: "Lai Hock Transport Packing Services Pte Ltd, 31 Jurong Port Road",
    deliveryAddress2: "#07-20",
    deliveryPostal: "619115",
    deliveryPlaceId: "ChIJ-delivery",
    deliveryLat: 1.31,
    deliveryLng: 103.71,
    portAddress1: null,
    portAddress2: null,
    portPostal: null,
    portPlaceId: null,
    portLat: null,
    portLng: null,
    returningDepotAddress1: null,
    returningDepotAddress2: null,
    returningDepotPostal: null,
    returningDepotPlaceId: null,
    returningDepotLat: null,
    returningDepotLng: null,
    returningDepotCode: null,
    returningDepotPending: false,
    returningDepotPendingText: null,
    pickupDateLocal: "2026-09-04",
    deliveryDateLocal: null,
    pickupDateDisplay: "4 Sep 2026 · Time not specified",
    deliveryDateDisplay: null,
    pickupDateNeedsReview: false,
    deliveryDateNeedsReview: false,
    picName: "Derek",
    picPhone: "91234567",
    notes: null,
    instructions: [],
    timingText: null,
    carrierName: "samudera",
    shipper: "ESL",
    vesselName: "ALS SUMIRE",
    voyage: "249N",
    containerSizeType: "40HC",
    autoTripDocumentRequirements: [
      {
        tripIndex: 0,
        signedDeliveryDoRequired: false,
        signedLorryChitRequired: true,
      },
    ],
    items: [
      {
        containerNumber: null,
        sealNumber: null,
        referenceNumber: "SGBKKCAE9294",
        quantity: 1,
      },
    ],
    pickupReference: "SGBKKCAE9294",
    duplicateOverrideAcknowledged: false,
    duplicateOverrideReason: null,
  };

  it("accepts a legitimate frontend confirmation payload", async () => {
    const transformed = await pipe.transform(
      { drafts: [legitimateWritableDraft] },
      { type: "body", metatype: JobMessageImportConfirmRequestDto },
    );
    expect(transformed.drafts).toHaveLength(1);
    expect(transformed.drafts[0].draftId).toBe("draft_1");
    expect(transformed.drafts[0].pickupReference).toBe("SGBKKCAE9294");
    expect(transformed.drafts[0].deliveryAddress2).toBe("#07-20");
    expect(transformed.drafts[0].pickupSourceText).toBeUndefined();
    expect(transformed.drafts[0].pickupVerificationStatus).toBeUndefined();
  });

  it("rejects response-only sourceText and verificationStatus on nested drafts", async () => {
    await expect(
      pipe.transform(
        {
          drafts: [
            {
              ...legitimateWritableDraft,
              pickupSourceText: "From - EK 30 Pioneer Sector 2",
              deliverySourceText: "to - HOCK CHUAN. 31 JURONG PORT ROAD #07-20",
              portSourceText: null,
              returningDepotSourceText: null,
              pickupVerificationStatus: "VERIFIED",
              deliveryVerificationStatus: "VERIFIED",
              portVerificationStatus: "UNRESOLVED",
              returningDepotVerificationStatus: "UNRESOLVED",
            },
          ],
        },
        { type: "body", metatype: JobMessageImportConfirmRequestDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects unknown nested draft properties", async () => {
    await expect(
      pipe.transform(
        {
          drafts: [
            {
              ...legitimateWritableDraft,
              inventedClientField: "nope",
            },
          ],
        },
        { type: "body", metatype: JobMessageImportConfirmRequestDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects client-supplied VERIFIED verification without allowing whitelist bypass", async () => {
    try {
      await pipe.transform(
        {
          drafts: [
            {
              ...legitimateWritableDraft,
              deliveryVerificationStatus: "VERIFIED",
            },
          ],
        },
        { type: "body", metatype: JobMessageImportConfirmRequestDto },
      );
      fail("expected ValidationPipe to reject client verification");
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const message = (err as BadRequestException).getResponse() as {
        message?: string[] | string;
      };
      const messages = Array.isArray(message.message)
        ? message.message
        : [String(message.message ?? "")];
      expect(
        messages.some((m) => /deliveryVerificationStatus should not exist/i.test(m)),
      ).toBe(true);
    }
  });

  it("accepts EXPORT writable slots for stuffing/port without source/verification", async () => {
    const exportDraft = {
      ...legitimateWritableDraft,
      movementType: "EXPORT",
      collectionType: null,
      pickupAddress1: "DB WHSE",
      pickupPostal: null,
      pickupPlaceId: null,
      pickupLat: null,
      pickupLng: null,
      deliveryAddress1: "7 Gul Circle",
      deliveryAddress2: null,
      deliveryPostal: "629563",
      deliveryPlaceId: "ChIJ-gul",
      portAddress1: "Cogent 1.Logistics Hub, 1 Buroh Crescent",
      portPostal: "627545",
      portPlaceId: "ChIJ-cogent",
      pickupDateLocal: null,
      timingText: "ETA 05/09@1030",
      pickupReference: null,
      items: [
        {
          containerNumber: "MSBU3879600",
          sealNumber: "FX47126059",
          referenceNumber: null,
          quantity: 1,
        },
      ],
    };
    const transformed = await pipe.transform(
      { drafts: [exportDraft] },
      { type: "body", metatype: JobMessageImportConfirmRequestDto },
    );
    expect(transformed.drafts[0].deliveryAddress1).toBe("7 Gul Circle");
    expect(transformed.drafts[0].portAddress1).toMatch(/Cogent/i);
    expect(transformed.drafts[0].timingText).toBe("ETA 05/09@1030");
    expect(transformed.drafts[0].pickupDateLocal).toBeNull();
  });

  it("accepts RETURN pending-depot acknowledgement on confirm contract", async () => {
    const returnDraft = {
      ...legitimateWritableDraft,
      movementType: "RETURN",
      collectionType: null,
      deliveryAddress1: null,
      deliveryPostal: null,
      deliveryPlaceId: null,
      returningDepotPending: true,
      returningDepotPendingText: "TBA depot",
      returningDepotCode: null,
      returningDepotAddress1: null,
    };
    const transformed = await pipe.transform(
      { drafts: [returnDraft] },
      { type: "body", metatype: JobMessageImportConfirmRequestDto },
    );
    expect(transformed.drafts[0].returningDepotPending).toBe(true);
    expect(transformed.drafts[0].returningDepotPendingText).toBe("TBA depot");
  });
});

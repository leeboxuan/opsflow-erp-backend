import {
  flagsForGeneratedTrip,
  normalizeAutoTripDocumentRequirements,
  normalizeTripDocumentCreateFlags,
} from "./trip-document-create-flags";

describe("trip document create flags", () => {
  it("keeps neither selected when flags are omitted or false", () => {
    expect(normalizeTripDocumentCreateFlags(undefined)).toEqual({
      signedDeliveryDoRequired: false,
      signedLorryChitRequired: false,
    });
    expect(
      normalizeTripDocumentCreateFlags({
        signedDeliveryDoRequired: false,
        signedLorryChitRequired: false,
      }),
    ).toEqual({
      signedDeliveryDoRequired: false,
      signedLorryChitRequired: false,
    });
  });

  it("keeps Import legs independent by tripIndex", () => {
    const rows = normalizeAutoTripDocumentRequirements([
      { tripIndex: 0, signedDeliveryDoRequired: true, signedLorryChitRequired: false },
      { tripIndex: 1, signedDeliveryDoRequired: false, signedLorryChitRequired: true },
    ]);
    expect(flagsForGeneratedTrip(rows, 0)).toEqual({
      signedDeliveryDoRequired: true,
      signedLorryChitRequired: false,
    });
    expect(flagsForGeneratedTrip(rows, 1)).toEqual({
      signedDeliveryDoRequired: false,
      signedLorryChitRequired: true,
    });
    expect(flagsForGeneratedTrip(rows, 2)).toEqual({
      signedDeliveryDoRequired: false,
      signedLorryChitRequired: false,
    });
  });
});

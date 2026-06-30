import { TripDocumentType } from "@prisma/client";
import { deriveTripDocumentStatus } from "./trip-document-list.helpers";

describe("deriveTripDocumentStatus", () => {
  it("marks trailer start photo as uploaded when present", () => {
    const status = deriveTripDocumentStatus([
      { type: TripDocumentType.TRAILER_START_PHOTO },
    ]);
    expect(status.trailerStartPhoto).toBe("UPLOADED");
    expect(status.trailerEndPhoto).toBe("PENDING");
  });

  it("marks signed delivery DO as SIGNED", () => {
    const status = deriveTripDocumentStatus([
      {
        type: TripDocumentType.DELIVERY_DO,
        generatedBySystem: true,
        isSigned: true,
      },
    ]);
    expect(status.deliveryDo).toBe("SIGNED");
  });

  it("marks signed pickup DO as SIGNED", () => {
    const status = deriveTripDocumentStatus([
      { type: TripDocumentType.PICKUP_DO, isSigned: true },
    ]);
    expect(status.pickupDo).toBe("SIGNED");
  });
});

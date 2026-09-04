import { TripDocumentType } from "@prisma/client";
import {
  ADMIN_VISIBLE_TRIP_DOCUMENT_TYPES,
  deriveTripDocumentStatus,
} from "./trip-document-list.helpers";

describe("ADMIN_VISIBLE_TRIP_DOCUMENT_TYPES", () => {
  it("includes Lorry Chit so web workspace can show generated PDFs", () => {
    expect(ADMIN_VISIBLE_TRIP_DOCUMENT_TYPES).toContain(TripDocumentType.LORRY_CHIT);
  });
});

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

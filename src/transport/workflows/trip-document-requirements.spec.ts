import { TripDocumentType, TripStatus } from "@prisma/client";
import {
  defaultTripDocumentRequirementRows,
  documentTypeSupportsCustomerSignature,
  ensureDefaultTripDocumentRequirementSnapshots,
  isTripDocumentRequirementFrozen,
} from "./trip-document-requirements";

describe("trip document requirement snapshots", () => {
  it("supports customer signature only for DO types", () => {
    expect(documentTypeSupportsCustomerSignature("DELIVERY_DO")).toBe(true);
    expect(documentTypeSupportsCustomerSignature("PICKUP_DO")).toBe(true);
    expect(documentTypeSupportsCustomerSignature("POD_PHOTO")).toBe(false);
    expect(documentTypeSupportsCustomerSignature("TRAILER_START_PHOTO")).toBe(false);
    expect(documentTypeSupportsCustomerSignature("CONTAINER_PHOTO")).toBe(false);
    expect(documentTypeSupportsCustomerSignature("SEAL_PHOTO")).toBe(false);
  });

  it("freezes requirements after draft", () => {
    expect(isTripDocumentRequirementFrozen(TripStatus.DRAFT)).toBe(false);
    expect(isTripDocumentRequirementFrozen(TripStatus.PUBLISHED)).toBe(true);
    expect(isTripDocumentRequirementFrozen(TripStatus.ONGOING)).toBe(true);
    expect(isTripDocumentRequirementFrozen(TripStatus.COMPLETED)).toBe(true);
  });

  it("does not rewrite existing snapshots when default config changes", async () => {
    const existing = defaultTripDocumentRequirementRows("t1", "trip1").map((row) => ({
      ...row,
      requiresSignature: row.type === TripDocumentType.DELIVERY_DO,
    }));
    const createMany = jest.fn();
    const prisma = {
      tripDocumentRequirement: {
        findMany: jest.fn().mockResolvedValue(existing.map((row) => ({ tripId: row.tripId }))),
        createMany,
      },
    };

    await ensureDefaultTripDocumentRequirementSnapshots(prisma, "t1", ["trip1"]);

    expect(createMany).not.toHaveBeenCalled();
  });

  it("seeds defaults only for trips that have no snapshot rows", async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      tripDocumentRequirement: {
        findMany: jest.fn().mockResolvedValue([{ tripId: "trip-existing" }]),
        createMany,
      },
    };

    await ensureDefaultTripDocumentRequirementSnapshots(prisma, "t1", [
      "trip-existing",
      "trip-new",
    ]);

    expect(createMany).toHaveBeenCalledTimes(1);
    const data = createMany.mock.calls[0][0].data;
    expect(data.every((row: { tripId: string }) => row.tripId === "trip-new")).toBe(true);
    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: TripDocumentType.DELIVERY_DO,
          isRequired: true,
          requiresSignature: true,
        }),
        expect.objectContaining({
          type: TripDocumentType.POD_PHOTO,
          isRequired: true,
          requiresSignature: false,
        }),
      ]),
    );
  });
});

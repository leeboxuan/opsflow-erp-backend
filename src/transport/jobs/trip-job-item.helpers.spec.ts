import {
  JobType,
  TripStatus,
} from "@prisma/client";
import {
  buildTripCargoFromLinks,
  evaluateTripPublishLinkReadiness,
  isContainerBasedTransportJob,
  isTripJobItemLinkFrozen,
  resolveSyncedTripContainerNumber,
} from "./trip-job-item.helpers";

describe("trip-job-item.helpers", () => {
  describe("isContainerBasedTransportJob", () => {
    it("requires container cargo job type AND itemCount > 0", () => {
      expect(isContainerBasedTransportJob(JobType.IMPORT, 2)).toBe(true);
      expect(isContainerBasedTransportJob(JobType.EXPORT, 1)).toBe(true);
      expect(isContainerBasedTransportJob(JobType.COLLECTION, 1)).toBe(true);
      expect(isContainerBasedTransportJob(JobType.LCL, 5)).toBe(false);
      expect(isContainerBasedTransportJob(JobType.IMPORT, 0)).toBe(false);
    });
  });

  describe("isTripJobItemLinkFrozen", () => {
    it("freezes COMPLETED and DONE only", () => {
      expect(isTripJobItemLinkFrozen(TripStatus.COMPLETED)).toBe(true);
      expect(isTripJobItemLinkFrozen(TripStatus.DONE)).toBe(true);
      expect(isTripJobItemLinkFrozen(TripStatus.DRAFT)).toBe(false);
      expect(isTripJobItemLinkFrozen(TripStatus.ONGOING)).toBe(false);
    });
  });

  describe("resolveSyncedTripContainerNumber", () => {
    it("mirrors single, nulls multi, preserves empty compat", () => {
      expect(resolveSyncedTripContainerNumber([{ itemCode: "ABCD1234567" }])).toBe(
        "ABCD1234567",
      );
      expect(
        resolveSyncedTripContainerNumber([
          { itemCode: "A" },
          { itemCode: "B" },
        ]),
      ).toBeNull();
      expect(resolveSyncedTripContainerNumber([], "LEGACY")).toBe("LEGACY");
      expect(resolveSyncedTripContainerNumber([])).toBeNull();
    });
  });

  describe("evaluateTripPublishLinkReadiness", () => {
    it("does not require links for LCL", () => {
      const r = evaluateTripPublishLinkReadiness({
        jobType: JobType.LCL,
        jobItemCount: 3,
        linkedJobItemCount: 0,
      });
      expect(r.required).toBe(false);
      expect(r.satisfied).toBe(true);
    });

    it("auto-heals single item", () => {
      const r = evaluateTripPublishLinkReadiness({
        jobType: JobType.IMPORT,
        jobItemCount: 1,
        linkedJobItemCount: 0,
        jobItemIds: ["item-1"],
      });
      expect(r.shouldAutoHealSingleItem).toBe(true);
      expect(r.singleJobItemId).toBe("item-1");
    });

    it("blocks multi-item without links", () => {
      const r = evaluateTripPublishLinkReadiness({
        jobType: JobType.IMPORT,
        jobItemCount: 3,
        linkedJobItemCount: 0,
        jobItemIds: ["a", "b", "c"],
      });
      expect(r.required).toBe(true);
      expect(r.satisfied).toBe(false);
      expect(r.shouldAutoHealSingleItem).toBe(false);
      expect(r.errorMessage).toMatch(/jobItemIds/i);
    });
  });

  describe("buildTripCargoFromLinks", () => {
    it("uses TripJobItem as sole SoT for container jobs", () => {
      const cargo = buildTripCargoFromLinks({
        jobType: JobType.IMPORT,
        links: [
          {
            id: "link-1",
            jobItemId: "item-a",
            containerNumberSnapshot: "TLLU1",
            jobItem: {
              id: "item-a",
              itemCode: "TLLU1",
              description: null,
              sealNo: "S1",
              pickupReference: null,
              qty: null,
            },
          },
        ],
        allJobItems: [
          { id: "item-a", itemCode: "TLLU1" },
          { id: "item-b", itemCode: "TLLU2" },
        ],
      });
      expect(cargo.cargoSource).toBe("TRIP_JOB_ITEM");
      expect(cargo.containers).toHaveLength(1);
      expect(cargo.containers![0].jobItemId).toBe("item-a");
    });

    it("does not invent all JobItems for unlinked container trips", () => {
      const cargo = buildTripCargoFromLinks({
        jobType: JobType.IMPORT,
        links: [],
        allJobItems: [
          { id: "item-a", itemCode: "TLLU1", sealNo: "S1" },
          { id: "item-b", itemCode: "TLLU2", sealNo: "S2" },
        ],
      });
      expect(cargo.cargoSource).toBe("EMPTY");
      expect(cargo.containers).toEqual([]);
    });

    it("shows LCL job items as ITEMS without requiring TripJobItem", () => {
      const cargo = buildTripCargoFromLinks({
        jobType: JobType.LCL,
        links: [],
        allJobItems: [
          { id: "item-a", itemCode: "BOX-1", description: "Carton" },
        ],
      });
      expect(cargo.mode).toBe("ITEMS");
      expect(cargo.cargoSource).toBe("EMPTY");
      expect(cargo.items).toHaveLength(1);
      expect(cargo.items![0].jobItemId).toBe("item-a");
    });
  });
});

import { BadRequestException } from "@nestjs/common";
import {
  lorryChitCargoRowsFromResolved,
  resolveLorryChitCargoFromTripLinks,
} from "./lorry-chit-cargo";

describe("resolveLorryChitCargoFromTripLinks", () => {
  it("uses the single TripJobItem link (not sibling JobItems)", () => {
    const resolved = resolveLorryChitCargoFromTripLinks([
      {
        jobItemId: "item-a",
        jobItem: {
          itemCode: "OOCU9212980",
          containerSize: "40HC",
          sealNo: "SL1",
        },
      },
    ]);
    expect(resolved.jobItemId).toBe("item-a");
    expect(resolved.containerNumber).toBe("OOCU9212980");
    expect(lorryChitCargoRowsFromResolved(resolved)).toEqual([
      {
        containerOrCargo: "OOCU9212980",
        sizeOrPackage: "40HC",
        remarks: "Seal: SL1",
      },
    ]);
  });

  it("leaves container blank when Collection itemCode is null", () => {
    const resolved = resolveLorryChitCargoFromTripLinks([
      {
        jobItemId: "item-anon",
        jobItem: { itemCode: null, containerSize: "20ft", sealNo: null },
      },
    ]);
    expect(resolved.containerNumber).toBeNull();
    expect(resolved.cargoRow.containerOrCargo).toBe("");
    expect(resolved.cargoRow.sizeOrPackage).toBe("20ft");
  });

  it("flags multiple links instead of silently taking the first", () => {
    expect(() =>
      resolveLorryChitCargoFromTripLinks(
        [
          { jobItemId: "item-a", jobItem: { itemCode: "AAAA" } },
          { jobItemId: "item-b", jobItem: { itemCode: "BBBB" } },
        ],
        { tripId: "trip-1" },
      ),
    ).toThrow(BadRequestException);
    try {
      resolveLorryChitCargoFromTripLinks([
        { jobItemId: "item-a", jobItem: { itemCode: "AAAA" } },
        { jobItemId: "item-b", jobItem: { itemCode: "BBBB" } },
      ]);
    } catch (e: any) {
      expect(String(e.message)).toMatch(/flag for review/i);
      expect(String(e.message)).toMatch(/item-a/);
      expect(String(e.message)).toMatch(/item-b/);
    }
  });

  it("emits a blank cargo row when the trip has no link yet", () => {
    const resolved = resolveLorryChitCargoFromTripLinks([], { tripId: "trip-1" });
    expect(resolved.jobItemId).toBe("");
    expect(resolved.containerNumber).toBeNull();
    expect(resolved.cargoRow).toEqual({
      containerOrCargo: "",
      sizeOrPackage: "",
      remarks: "",
    });
  });

  it("two Trips under the same Job each resolve only their own container", () => {
    const jobItems = [
      { id: "item-1", itemCode: "CONT-TRIP-1", containerSize: "40HC" },
      { id: "item-2", itemCode: "CONT-TRIP-2", containerSize: "20GP" },
    ];
    const trip1Links = [
      { jobItemId: "item-1", jobItem: jobItems[0] },
    ];
    const trip2Links = [
      { jobItemId: "item-2", jobItem: jobItems[1] },
    ];
    const chit1 = resolveLorryChitCargoFromTripLinks(trip1Links, { tripId: "t1" });
    const chit2 = resolveLorryChitCargoFromTripLinks(trip2Links, { tripId: "t2" });
    expect(chit1.cargoRow.containerOrCargo).toBe("CONT-TRIP-1");
    expect(chit2.cargoRow.containerOrCargo).toBe("CONT-TRIP-2");
    expect(chit1.cargoRow.containerOrCargo).not.toBe(chit2.cargoRow.containerOrCargo);
    expect(lorryChitCargoRowsFromResolved(chit1)).toHaveLength(1);
    expect(lorryChitCargoRowsFromResolved(chit2)).toHaveLength(1);
  });
});

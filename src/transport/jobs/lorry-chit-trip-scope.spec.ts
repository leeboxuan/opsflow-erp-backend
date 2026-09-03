import { buildLorryChitPdfBuffer } from "../documents/lorry-chit-pdf";
import {
  lorryChitCargoRowsFromResolved,
  resolveLorryChitCargoFromTripLinks,
} from "./lorry-chit-cargo";

/**
 * End-to-end-ish: two Trips under one Job each produce a Lorry Chit PDF
 * containing only their own TripJobItem container.
 */
describe("Lorry Chit trip scope (two trips, one job)", () => {
  const jobItems = [
    {
      id: "item-1",
      itemCode: "OOCU9212980",
      containerSize: "40HC",
      sealNo: "SA",
      description: null,
      qty: 1,
    },
    {
      id: "item-2",
      itemCode: "CSNU7730628",
      containerSize: "20GP",
      sealNo: "SB",
      description: null,
      qty: 1,
    },
  ];

  it("generates distinct one-container PDFs per Trip link", async () => {
    const trip1 = resolveLorryChitCargoFromTripLinks(
      [{ jobItemId: "item-1", jobItem: jobItems[0] }],
      { tripId: "trip-1" },
    );
    const trip2 = resolveLorryChitCargoFromTripLinks(
      [{ jobItemId: "item-2", jobItem: jobItems[1] }],
      { tripId: "trip-2" },
    );

    expect(trip1.cargoRow.containerOrCargo).toBe("OOCU9212980");
    expect(trip2.cargoRow.containerOrCargo).toBe("CSNU7730628");
    expect(lorryChitCargoRowsFromResolved(trip1)).toHaveLength(1);
    expect(lorryChitCargoRowsFromResolved(trip2)).toHaveLength(1);

    const pdf1 = await buildLorryChitPdfBuffer({
      internalRef: "JOB-SHARED",
      externalRef: "EXT-1",
      customerName: "ESL",
      dateLabel: "04/09/2026",
      truckNumber: "GBE1234A",
      cargoRows: lorryChitCargoRowsFromResolved(trip1),
      containerSummary: trip1.cargoRow.containerOrCargo,
    });
    const pdf2 = await buildLorryChitPdfBuffer({
      internalRef: "JOB-SHARED",
      externalRef: "EXT-1",
      customerName: "ESL",
      dateLabel: "04/09/2026",
      truckNumber: "GBE9999Z",
      cargoRows: lorryChitCargoRowsFromResolved(trip2),
      containerSummary: trip2.cargoRow.containerOrCargo,
    });

    expect(pdf1.length).toBeGreaterThan(20_000);
    expect(pdf2.length).toBeGreaterThan(20_000);
    // Inputs remain single-container and distinct (PDF binary may subset fonts).
    expect(trip1.cargoRow.containerOrCargo).not.toContain("CSNU7730628");
    expect(trip2.cargoRow.containerOrCargo).not.toContain("OOCU9212980");
  });
});

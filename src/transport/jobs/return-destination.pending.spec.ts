import {
  pendingReturnDestinationJobFields,
  resolveReturnDestinationResolution,
} from "./return-destination";

describe("return destination pending intake", () => {
  it("resolves explicit pending without inventing an address", () => {
    const resolved = resolveReturnDestinationResolution({
      returningDepotPending: true,
      returningDepotPendingText: "TBA — waiting for carrier confirmation",
      returningDepotAddress1: "TBA — waiting for carrier confirmation",
    });
    expect(resolved).toEqual({
      kind: "pending",
      pendingText: "TBA — waiting for carrier confirmation",
    });
    const fields = pendingReturnDestinationJobFields(
      resolved!.kind === "pending" ? resolved.pendingText : null,
    );
    expect(fields.deliveryAddress1).toBe("");
    expect(fields.returningDepotPending).toBe(true);
    expect(fields.returningDepotPendingText).toMatch(/TBA/);
    expect(fields.returningDepotAddress1).toBeNull();
  });

  it("returns null when not pending and no depot address", () => {
    expect(
      resolveReturnDestinationResolution({
        returningDepotPending: false,
        returningDepotAddress1: null,
        returningDepotCode: null,
      }),
    ).toBeNull();
  });
});

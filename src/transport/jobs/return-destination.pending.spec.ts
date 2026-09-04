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
      resolved.kind === "pending" ? resolved.pendingText : null,
    );
    expect(fields.deliveryAddress1).toBe("");
    expect(fields.returningDepotPending).toBe(true);
    expect(fields.returningDepotPendingText).toMatch(/TBA/);
    expect(fields.returningDepotAddress1).toBeNull();
  });

  it("auto-pends when destination is absent without an explicit flag", () => {
    const resolved = resolveReturnDestinationResolution({
      returningDepotPending: false,
      returningDepotAddress1: null,
      returningDepotCode: null,
    });
    expect(resolved).toEqual({ kind: "pending", pendingText: null });
  });

  it("auto-pends TBA text and preserves notes (never as a real address)", () => {
    const resolved = resolveReturnDestinationResolution({
      returningDepotAddress1: "TBA (wait carrier update return to HLA or tuas)",
      returningDepotCode: null,
    });
    expect(resolved.kind).toBe("pending");
    expect(resolved.kind === "pending" ? resolved.pendingText : null).toMatch(/TBA/i);
    const fields = pendingReturnDestinationJobFields(
      resolved.kind === "pending" ? resolved.pendingText : null,
    );
    expect(fields.returningDepotAddress1).toBeNull();
    expect(fields.deliveryAddress1).toBe("");
  });

  it("still resolves a real depot selection", () => {
    const resolved = resolveReturnDestinationResolution({
      returningDepotCode: "COG1",
      returningDepotAddress1: "Cogent Yard",
      returningDepotPostal: "629117",
      returningDepotPlaceId: "place-cog",
    });
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind === "resolved") {
      expect(resolved.fields.deliveryAddress1).toBe("Cogent Yard");
      expect(resolved.fields.returningDepotCode).toBe("COG1");
    }
  });
});

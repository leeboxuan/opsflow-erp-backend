import {
  buildPlacesAddressLine1,
  buildPlacesAddressLine2FromSubpremise,
  extractSingaporePostalFromText,
} from "./places-address-line";

describe("places address line helpers", () => {
  it("does not duplicate Rd vs Road place name and street", () => {
    expect(
      buildPlacesAddressLine1({
        name: "31 Jurong Port Rd",
        block: "31",
        route: "Jurong Port Road",
      }),
    ).toBe("31 Jurong Port Road");
  });

  it("keeps distinct company name + street", () => {
    expect(
      buildPlacesAddressLine1({
        name: "Hock Chuan",
        block: "31",
        route: "Jurong Port Road",
      }),
    ).toBe("Hock Chuan, 31 Jurong Port Road");
  });

  it("formats subpremise units only", () => {
    expect(buildPlacesAddressLine2FromSubpremise("07-20")).toBe("#07-20");
    expect(buildPlacesAddressLine2FromSubpremise("#07-20")).toBe("#07-20");
    expect(buildPlacesAddressLine2FromSubpremise(null)).toBe("");
  });

  it("extracts Singapore postal from formatted address text", () => {
    expect(
      extractSingaporePostalFromText("PSA Tuas Port Transport Hub, Singapore 639386"),
    ).toBe("639386");
    expect(extractSingaporePostalFromText("No postal here")).toBeNull();
  });
});

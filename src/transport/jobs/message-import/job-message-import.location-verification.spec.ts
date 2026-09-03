import {
  isUnresolvedLocationText,
  locationVerificationWarning,
  matchMasterLocation,
  resolveImportedLocation,
} from "./job-message-import.location-verification";

describe("job-message-import location verification", () => {
  const depots = [
    {
      code: "COGENT",
      name: "Cogent",
      addressLine1: "Cogent Yard",
      postalCode: "629117",
      placeId: "place-cogent",
      lat: 1.3,
      lng: 103.7,
    },
  ];

  it("keeps TBA unresolved and never invents a postal code", () => {
    const resolved = resolveImportedLocation({
      rawText: "TBA (wait carrier update return to HLA or tuas)",
      catalogue: depots,
    });
    expect(resolved.verificationStatus).toBe("UNRESOLVED");
    expect(resolved.postal).toBeNull();
    expect(resolved.placeId).toBeNull();
    expect(isUnresolvedLocationText("tba")).toBe(true);
  });

  it("does not match vague aliases such as ppz or db whse", () => {
    expect(matchMasterLocation("ppz", depots)).toBeNull();
    expect(matchMasterLocation("db whse", depots)).toBeNull();
    const resolved = resolveImportedLocation({ rawText: "ppz", catalogue: depots });
    expect(resolved.verificationStatus).toBe("NEEDS_REVIEW");
    expect(resolved.postal).toBeNull();
    expect(resolved.address1).toBe("ppz");
  });

  it("confidently matches unique master code/name", () => {
    const resolved = resolveImportedLocation({
      rawText: "Cogent",
      catalogue: depots,
    });
    expect(resolved.verificationStatus).toBe("VERIFIED");
    expect(resolved.postal).toBe("629117");
    expect(resolved.code).toBe("COGENT");
  });

  it("treats Google placeId without a 6-digit postal as needs review", () => {
    const resolved = resolveImportedLocation({
      rawText: "31 Jurong Port Road",
      placeId: "ChIJplace",
      address1: "31 Jurong Port Road",
      postal: null,
    });
    expect(resolved.verificationStatus).toBe("NEEDS_REVIEW");
    expect(resolved.postal).toBeNull();
    expect(resolved.sourceText).toBe("31 Jurong Port Road");
  });

  it("verifies Google placeId only when a Singapore postal is present", () => {
    const resolved = resolveImportedLocation({
      rawText: "31 Jurong Port Road",
      placeId: "ChIJplace",
      address1: "31 Jurong Port Road",
      postal: "619123",
    });
    expect(resolved.verificationStatus).toBe("VERIFIED");
    expect(resolved.postal).toBe("619123");
  });

  it("marks typed address plus postal as manually confirmed, not Google/master verified", () => {
    const resolved = resolveImportedLocation({
      rawText: "mystery yard xyz",
      address1: "15 Tuas Avenue 18",
      postal: "638905",
    });
    expect(resolved.verificationStatus).toBe("MANUAL_CONFIRMED");
    expect(resolved.sourceText).toBe("mystery yard xyz");
    expect(resolved.placeId).toBeNull();
  });

  it("returns the review copy for unverified addresses", () => {
    expect(locationVerificationWarning("NEEDS_REVIEW")?.message).toBe(
      "Postal code not verified — select an address or enter it manually.",
    );
  });
});

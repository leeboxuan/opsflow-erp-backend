import {
  applyResolvedLocationsOntoReviewed,
  findAmbiguousMasterLocations,
  isUnresolvedLocationText,
  locationVerificationWarning,
  matchMasterLocation,
  resolveImportedLocation,
  revalidateReviewedPlacesWithTrustedDetails,
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

  const ambiguousCogent = [
    {
      code: "COG1",
      name: "Cogent Jurong",
      addressLine1: "1 Jurong",
      postalCode: "629117",
    },
    {
      code: "COG2",
      name: "Cogent Tuas",
      addressLine1: "2 Tuas",
      postalCode: "639123",
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

  it("does not silently pick the first Cogent when several match", () => {
    expect(matchMasterLocation("cogent", ambiguousCogent)).toBeNull();
    expect(findAmbiguousMasterLocations("cogent", ambiguousCogent)).toHaveLength(2);
    const resolved = resolveImportedLocation({
      rawText: "cogent",
      catalogue: ambiguousCogent,
    });
    expect(resolved.verificationStatus).toBe("NEEDS_REVIEW");
    expect(resolved.code).toBeNull();
    expect(resolved.address1).toBe("cogent");
    expect(resolved.sourceText).toBe("cogent");
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

  it("does not verify client-shaped placeId+postal without trusted Places resolution", () => {
    const resolved = resolveImportedLocation({
      rawText: "31 Jurong Port Road",
      placeId: "ChIJplace",
      address1: "31 Jurong Port Road",
      postal: "619123",
    });
    expect(resolved.verificationStatus).toBe("NEEDS_REVIEW");
    expect(resolved.postal).toBe("619123");
  });

  it("verifies placeId+postal only after trusted Places resolution", () => {
    const resolved = resolveImportedLocation({
      rawText: "31 Jurong Port Road",
      placeId: "ChIJplace",
      address1: "31 Jurong Port Road",
      postal: "619123",
      trustedPlacesResolution: true,
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

  it("overwrites a conflicting depot address when a canonical depot code matches", () => {
    const catalogues = {
      ports: [],
      depots: [
        {
          code: "ACS1",
          name: "Allcontainer Services",
          addressLine1: "7 Gul Circle",
          addressLine2: null,
          postalCode: "629563",
          placeId: "ChIJ-acs1",
          lat: 1.3,
          lng: 103.7,
        },
      ],
    };
    const next = applyResolvedLocationsOntoReviewed(
      {
        movementType: "RETURN",
        pickupAddress1: "Customer",
        pickupAddress2: null,
        pickupPostal: null,
        pickupPlaceId: null,
        pickupLat: null,
        pickupLng: null,
        deliveryAddress1: null,
        deliveryAddress2: null,
        deliveryPostal: null,
        deliveryPlaceId: null,
        deliveryLat: null,
        deliveryLng: null,
        portAddress1: null,
        portPostal: null,
        portPlaceId: null,
        returningDepotAddress1: "14 Pioneer Sector 2",
        returningDepotAddress2: null,
        returningDepotPostal: "628071",
        returningDepotPlaceId: null,
        returningDepotLat: null,
        returningDepotLng: null,
        returningDepotCode: "ACS1",
      },
      catalogues,
    );
    expect(next.returningDepotCode).toBe("ACS1");
    expect(next.returningDepotAddress1).toBe("7 Gul Circle");
    expect(next.returningDepotPostal).toBe("629563");
    expect((next as { returningDepotVerificationStatus?: string }).returningDepotVerificationStatus).toBe(
      "VERIFIED",
    );
  });

  it("returns the review copy for unverified addresses", () => {
    expect(locationVerificationWarning("NEEDS_REVIEW")?.message).toBe(
      "Postal code not verified — select an address or enter it manually.",
    );
  });

  it("upgrades placeId to VERIFIED only when trusted Places details yield a postal", async () => {
    const next = await revalidateReviewedPlacesWithTrustedDetails(
      {
        movementType: "EXPORT",
        pickupAddress1: "Yard",
        pickupAddress2: null,
        pickupPostal: "619123",
        pickupPlaceId: "ChIJ-a",
        pickupLat: null,
        pickupLng: null,
        pickupVerificationStatus: "NEEDS_REVIEW",
        deliveryAddress1: null,
        deliveryAddress2: null,
        deliveryPostal: null,
        deliveryPlaceId: null,
        deliveryLat: null,
        deliveryLng: null,
        portAddress1: "PSA Tuas",
        portPostal: "639386",
        portPlaceId: "ChIJ-port",
        portVerificationStatus: "NEEDS_REVIEW",
        returningDepotAddress1: null,
        returningDepotAddress2: null,
        returningDepotPostal: null,
        returningDepotPlaceId: null,
        returningDepotLat: null,
        returningDepotLng: null,
        returningDepotCode: null,
      },
      async (placeId) => {
        if (placeId === "ChIJ-port") {
          return {
            postalCode: "",
            formattedAddress: "PSA Tuas Port, Singapore 639386",
          };
        }
        if (placeId === "ChIJ-a") {
          return { postalCode: "619123", formattedAddress: "Yard, Singapore 619123" };
        }
        return null;
      },
    );
    expect(next.portVerificationStatus).toBe("VERIFIED");
    expect(next.portPostal).toBe("639386");
    expect(next.pickupVerificationStatus).toBe("VERIFIED");
  });

  it("keeps placeId reviewable when Places has no postal", async () => {
    const next = await revalidateReviewedPlacesWithTrustedDetails(
      {
        movementType: "EXPORT",
        pickupAddress1: "Somewhere",
        pickupAddress2: null,
        pickupPostal: null,
        pickupPlaceId: "ChIJ-empty",
        pickupLat: null,
        pickupLng: null,
        pickupVerificationStatus: "NEEDS_REVIEW",
        deliveryAddress1: null,
        deliveryAddress2: null,
        deliveryPostal: null,
        deliveryPlaceId: null,
        deliveryLat: null,
        deliveryLng: null,
        portAddress1: null,
        portPostal: null,
        portPlaceId: null,
        returningDepotAddress1: null,
        returningDepotAddress2: null,
        returningDepotPostal: null,
        returningDepotPlaceId: null,
        returningDepotLat: null,
        returningDepotLng: null,
        returningDepotCode: null,
      },
      async () => ({ postalCode: "", formattedAddress: "No postal here" }),
    );
    expect(next.pickupVerificationStatus).toBe("NEEDS_REVIEW");
    expect(next.pickupPostal).toBeNull();
  });
});

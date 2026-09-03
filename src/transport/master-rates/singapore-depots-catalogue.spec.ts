import {
  ALL_SINGAPORE_DEPOT_SEED_ROWS,
  OFFICIAL_PORTNET_SINGAPORE_DEPOTS,
  PLACEHOLDER_SINGAPORE_DEPOTS,
  assertUniqueSingaporeDepotCodes,
  seedSingaporeDepots,
} from "../../../prisma/seeds/singapore-depots.portnet.seed";

describe("Singapore Portnet depot catalogue", () => {
  it("has unique codes across placeholders and official rows", () => {
    const codes = assertUniqueSingaporeDepotCodes();
    expect(codes.length).toBe(ALL_SINGAPORE_DEPOT_SEED_ROWS.length);
    expect(OFFICIAL_PORTNET_SINGAPORE_DEPOTS).toHaveLength(45);
  });

  it("keeps legacy placeholder codes with null hours", () => {
    const byCode = new Map(PLACEHOLDER_SINGAPORE_DEPOTS.map((r) => [r.code, r]));
    for (const code of ["GUL7", "GUL_DEFAULT", "TUAS_DEPOT", "PASIR_DEPOT"]) {
      expect(byCode.has(code)).toBe(true);
      expect(byCode.get(code)!.operatingHoursSummary).toBeNull();
    }
  });

  it("stores OCW4 hours as null (TO BE ADVISED)", () => {
    const ocw4 = OFFICIAL_PORTNET_SINGAPORE_DEPOTS.find((r) => r.code === "OCW4");
    expect(ocw4).toBeTruthy();
    expect(ocw4!.operatingHoursSummary).toBeNull();
    expect(ocw4!.addressLine1).toContain("10 Tuas South Street 2");
  });

  it("uses corrected SKT1 address from Portnet (Jalan Terusan)", () => {
    const skt1 = OFFICIAL_PORTNET_SINGAPORE_DEPOTS.find((r) => r.code === "SKT1");
    expect(skt1!.addressLine1).toBe("30 Jalan Terusan");
  });

  it("upserts by code idempotently without creating duplicates", async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma: any = {
      masterSingaporeDepot: { upsert },
    };

    await seedSingaporeDepots(prisma);
    await seedSingaporeDepots(prisma);

    expect(upsert).toHaveBeenCalledTimes(ALL_SINGAPORE_DEPOT_SEED_ROWS.length * 2);
    const whereCodes = upsert.mock.calls.map((c: any[]) => c[0].where.code);
    expect(new Set(whereCodes).size).toBe(ALL_SINGAPORE_DEPOT_SEED_ROWS.length);
  });
});

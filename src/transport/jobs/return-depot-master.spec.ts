import { LogisticsLocationType } from "@prisma/client";

import {
  resolveReturningDepotCodeFromId,
  resolveReturningDepotMasterByCode,
} from "./return-depot-master";

describe("return-depot-master", () => {
  function makePrisma(overrides?: {
    singaporeByCode?: Record<string, any> | null;
    singaporeById?: Record<string, any> | null;
    logisticsByCode?: Record<string, any> | null;
    logisticsFindFirst?: jest.Mock;
  }) {
    const singaporeByCode = overrides?.singaporeByCode ?? {};
    const singaporeById = overrides?.singaporeById ?? {};
    const logisticsByCode = overrides?.logisticsByCode ?? {};
    return {
      masterSingaporeDepot: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.code) {
            return Promise.resolve(singaporeByCode[where.code] ?? null);
          }
          if (where?.id) {
            return Promise.resolve(singaporeById[where.id] ?? null);
          }
          return Promise.resolve(null);
        }),
      },
      masterLogisticsLocation: {
        findFirst:
          overrides?.logisticsFindFirst ??
          jest.fn().mockImplementation(({ where }: any) => {
            if (where?.code) {
              return Promise.resolve(logisticsByCode[where.code] ?? null);
            }
            if (where?.id) {
              const hit = Object.values(logisticsByCode).find(
                (row: any) => row.id === where.id,
              );
              return Promise.resolve(hit ?? null);
            }
            return Promise.resolve(null);
          }),
      },
    };
  }

  describe("resolveReturningDepotMasterByCode", () => {
    it("prefers MasterSingaporeDepot when addressLine1 is present", async () => {
      const prisma = makePrisma({
        singaporeByCode: {
          ACS1: {
            code: "ACS1",
            addressLine1: "14 Pioneer Sector 2",
            addressLine2: null,
            postalCode: "628071",
            placeId: "ChIJ-acs1",
            lat: 1.31,
            lng: 103.69,
          },
        },
        logisticsByCode: {
          ACS1: {
            id: "log-acs1",
            code: "ACS1",
            addressLine1: "Should not win",
            addressLine2: null,
            postalCode: "000000",
            placeId: null,
            lat: null,
            lng: null,
          },
        },
      });

      const resolved = await resolveReturningDepotMasterByCode(prisma as any, "ACS1");

      expect(resolved).toEqual({
        code: "ACS1",
        addressLine1: "14 Pioneer Sector 2",
        addressLine2: null,
        postalCode: "628071",
        placeId: "ChIJ-acs1",
        lat: 1.31,
        lng: 103.69,
        logisticsLocationId: null,
      });
      expect(prisma.masterLogisticsLocation.findFirst).not.toHaveBeenCalled();
    });

    it("falls back to active logistics DEPOT when Singapore depot is missing", async () => {
      const prisma = makePrisma({
        singaporeByCode: {},
        logisticsByCode: {
          GUL: {
            id: "loc-gul",
            code: "GUL",
            addressLine1: "7 Gul Circle",
            addressLine2: null,
            postalCode: "629563",
            placeId: "ChIJ-gul",
            lat: 1.3,
            lng: 103.7,
          },
        },
      });

      const resolved = await resolveReturningDepotMasterByCode(prisma as any, "GUL");

      expect(resolved).toMatchObject({
        code: "GUL",
        addressLine1: "7 Gul Circle",
        postalCode: "629563",
        logisticsLocationId: "loc-gul",
      });
      expect(prisma.masterLogisticsLocation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            code: "GUL",
            type: LogisticsLocationType.DEPOT,
            isActive: true,
          }),
        }),
      );
    });

    it("returns null for unknown codes", async () => {
      const prisma = makePrisma();
      await expect(
        resolveReturningDepotMasterByCode(prisma as any, "NOPE"),
      ).resolves.toBeNull();
    });

    it("returns null for blank / whitespace codes", async () => {
      const prisma = makePrisma();
      await expect(
        resolveReturningDepotMasterByCode(prisma as any, "  "),
      ).resolves.toBeNull();
      expect(prisma.masterSingaporeDepot.findUnique).not.toHaveBeenCalled();
    });

    it("skips Singapore rows without addressLine1 and tries logistics", async () => {
      const prisma = makePrisma({
        singaporeByCode: {
          ACS1: {
            code: "ACS1",
            addressLine1: "   ",
            addressLine2: null,
            postalCode: null,
            placeId: null,
            lat: null,
            lng: null,
          },
        },
        logisticsByCode: {
          ACS1: {
            id: "loc-acs1",
            code: "ACS1",
            addressLine1: "7 Gul Circle",
            addressLine2: null,
            postalCode: "629563",
            placeId: null,
            lat: null,
            lng: null,
          },
        },
      });

      const resolved = await resolveReturningDepotMasterByCode(prisma as any, "ACS1");
      expect(resolved?.logisticsLocationId).toBe("loc-acs1");
      expect(resolved?.addressLine1).toBe("7 Gul Circle");
    });
  });

  describe("resolveReturningDepotCodeFromId", () => {
    it("resolves Singapore depot id before logistics", async () => {
      const prisma = makePrisma({
        singaporeById: { "sg-acs1": { code: "ACS1" } },
      });

      await expect(
        resolveReturningDepotCodeFromId(prisma as any, "sg-acs1"),
      ).resolves.toBe("ACS1");
      expect(prisma.masterLogisticsLocation.findFirst).not.toHaveBeenCalled();
    });

    it("falls back to logistics DEPOT id", async () => {
      const logisticsFindFirst = jest.fn().mockResolvedValue({ code: "GUL7_DEPOT" });
      const prisma = makePrisma({ logisticsFindFirst });

      await expect(
        resolveReturningDepotCodeFromId(prisma as any, "loc-gul7"),
      ).resolves.toBe("GUL7_DEPOT");
      expect(logisticsFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "loc-gul7",
            type: LogisticsLocationType.DEPOT,
            isActive: true,
          }),
        }),
      );
    });

    it("returns null for blank id", async () => {
      const prisma = makePrisma();
      await expect(
        resolveReturningDepotCodeFromId(prisma as any, null),
      ).resolves.toBeNull();
    });
  });
});

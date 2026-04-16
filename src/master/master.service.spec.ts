import { MasterFileType } from "@prisma/client";
import { MasterDataService } from "./master.service";

describe("MasterDataService getActiveMasterItems", () => {
  it("returns active tenant-wide DRIVER_PAYOUT master and parsed rows", async () => {
    const masterFileFindFirst = jest.fn().mockResolvedValue({
      id: "mf-driver",
      tenantId: "t1",
      customerCompanyId: null,
      type: MasterFileType.DRIVER_PAYOUT,
      isActive: true,
      uploadedAt: new Date(),
    });
    const payoutFindMany = jest.fn().mockResolvedValue([
      { id: "dp1", masterFileId: "mf-driver", code: "A-1", label: "Normal full trip", rateCents: 1800 },
    ]);
    const prisma: any = {
      masterFile: { findFirst: masterFileFindFirst },
      driverPayoutItem: { findMany: payoutFindMany },
      dhcReferenceItem: { findMany: jest.fn() },
      customerQuotationItem: { findMany: jest.fn() },
    };
    const supabase: any = { getClient: jest.fn() };
    const svc = new MasterDataService(prisma, supabase);

    const result = await svc.getActiveMasterItems("t1", MasterFileType.DRIVER_PAYOUT, null);
    expect(masterFileFindFirst).toHaveBeenCalledWith({
      where: {
        tenantId: "t1",
        type: MasterFileType.DRIVER_PAYOUT,
        isActive: true,
        customerCompanyId: null,
      },
      orderBy: { uploadedAt: "desc" },
    });
    expect(result.masterFile?.id).toBe("mf-driver");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      code: "A-1",
      label: "Normal full trip",
      rateCents: 1800,
    });
  });

  it("returns active tenant-wide DHC_REFERENCE master and parsed rows", async () => {
    const masterFileFindFirst = jest.fn().mockResolvedValue({
      id: "mf-dhc",
      tenantId: "t1",
      customerCompanyId: null,
      type: MasterFileType.DHC_REFERENCE,
      isActive: true,
      uploadedAt: new Date(),
    });
    const dhcFindMany = jest.fn().mockResolvedValue([
      { id: "dhc1", masterFileId: "mf-dhc", code: "DHC-1", label: "Depot handling", rateCents: 3500 },
    ]);
    const prisma: any = {
      masterFile: { findFirst: masterFileFindFirst },
      driverPayoutItem: { findMany: jest.fn() },
      dhcReferenceItem: { findMany: dhcFindMany },
      customerQuotationItem: { findMany: jest.fn() },
    };
    const supabase: any = { getClient: jest.fn() };
    const svc = new MasterDataService(prisma, supabase);

    const result = await svc.getActiveMasterItems("t1", MasterFileType.DHC_REFERENCE, null);
    expect(masterFileFindFirst).toHaveBeenCalledWith({
      where: {
        tenantId: "t1",
        type: MasterFileType.DHC_REFERENCE,
        isActive: true,
        customerCompanyId: null,
      },
      orderBy: { uploadedAt: "desc" },
    });
    expect(result.masterFile?.id).toBe("mf-dhc");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      code: "DHC-1",
      label: "Depot handling",
      rateCents: 3500,
    });
  });

  it("parseDriverPayoutItems generates unique codes with suffixes for duplicates", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["A", "DESCRIPTION - CONTAINER RATE", "UOM", "Rates"],
      [1, "Normal full trip", "Per Trip", 18],
      [2, "Normal half trip", "Per Trip", 10],
      ["A", "DESCRIPTION - CONTAINER RATE", "UOM", "Rates"],
      [1, "Normal full trip duplicate section", "Per Trip", 20],
      [2, "Normal half trip duplicate section", "Per Trip", 11],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "LATEST RATES");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const prisma: any = {};
    const supabase: any = { getClient: jest.fn() };
    const svc = new MasterDataService(prisma, supabase);
    const parsed = (svc as any).parseDriverPayoutItems(Buffer.from(buf));

    expect(parsed.items.map((i: any) => i.code)).toEqual([
      "A-1",
      "A-2",
      "A-1-2",
      "A-2-2",
    ]);
    const unique = new Set(parsed.items.map((i: any) => i.code));
    expect(unique.size).toBe(parsed.items.length);
  });

  it("parseDriverPayoutItems keeps section E/category and preserves ambiguous rows as manual amount", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["D", "DESCRIPTION - MISCELLANEOUS", "UOM", "Rates"],
      [1, "Previous section row", "Per Month", 120],
      ["E", "", "", ""],
      ["Fixed Monthly Payments", "", "", ""],
      ["DESCRIPTION", "UOM", "RATES", ""],
      [1, "Early section E row", "Per Month", "$450 / $500"],
      [2, "Another early section E row", "Per Month", "$650 / $700"],
      [3, "Season Parking (OPTIONAL) - DRIVER", "Per Month", 150],
      [4, "Accommodation in Singapore", "Per Month", 550],
      [5, "Cashcard", "Per Month", 50],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "LATEST RATES");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const prisma: any = {};
    const supabase: any = { getClient: jest.fn() };
    const svc = new MasterDataService(prisma, supabase);
    const parsed = (svc as any).parseDriverPayoutItems(Buffer.from(buf));

    const fixedMonthlyItems = parsed.items.filter((i: any) =>
      [
        "Season Parking (OPTIONAL) - DRIVER",
        "Accommodation in Singapore",
        "Cashcard",
      ].includes(i.label),
    );

    expect(fixedMonthlyItems).toHaveLength(3);
    fixedMonthlyItems.forEach((item: any) => {
      expect(item.section).toBe("E");
      expect(item.category).toBe("Fixed Monthly Payments");
    });

    const manualRows = parsed.items.filter((i: any) =>
      ["Early section E row", "Another early section E row"].includes(i.label),
    );
    expect(manualRows).toHaveLength(2);
    manualRows.forEach((item: any) => {
      expect(item.section).toBe("E");
      expect(item.category).toBe("Fixed Monthly Payments");
      expect(item.rateCents).toBeNull();
      expect(item.requiresManualAmount).toBe(true);
      expect(item.isSelectableForTripEarning).toBe(false);
      expect(item.rawRateText).toMatch(/\$/);
    });

    expect(parsed.items.find((i: any) => i.label === "Previous section row")).toMatchObject({
      section: "D",
      category: "DESCRIPTION - MISCELLANEOUS",
    });
  });
});

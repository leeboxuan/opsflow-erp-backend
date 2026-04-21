import { MasterFileStatus, MasterFileType } from "@prisma/client";
import { MasterDataService } from "./master.service";

describe("MasterDataService getActiveMasterItems", () => {
  it("rejects deprecated CUSTOMER_QUOTATION master uploads", async () => {
    const prisma: any = {};
    const supabase: any = { getClient: jest.fn() };
    const svc = new MasterDataService(prisma, supabase);

    await expect(
      svc.uploadAndParseMasterFile(
        "t1",
        MasterFileType.CUSTOMER_QUOTATION,
        {
          originalname: "legacy.xlsx",
          mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from("x"),
        } as any,
        null,
        null,
        "comp1",
      ),
    ).rejects.toThrow("CUSTOMER_QUOTATION master upload is deprecated. Use QUOTATION.");
  });

  it("rejects non-excel QUOTATION master uploads", async () => {
    const prisma: any = {};
    const supabase: any = { getClient: jest.fn() };
    const svc = new MasterDataService(prisma, supabase);

    await expect(
      (svc as any).parseQuotationItemsFromFile({
        originalname: "rates.pdf",
        mimetype: "application/pdf",
        buffer: Buffer.from("x"),
      }),
    ).rejects.toThrow("QUOTATION master upload must be Excel (.xlsx/.xls)");
  });

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
        status: MasterFileStatus.PARSED,
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

  it("returns no active DHC items when only failed versions exist", async () => {
    const masterFileFindFirst = jest.fn().mockResolvedValue(null);
    const prisma: any = {
      masterFile: { findFirst: masterFileFindFirst },
      driverPayoutItem: { findMany: jest.fn() },
      dhcReferenceItem: { findMany: jest.fn() },
      customerQuotationItem: { findMany: jest.fn() },
    };
    const supabase: any = { getClient: jest.fn() };
    const svc = new MasterDataService(prisma, supabase);

    const result = await svc.getActiveMasterItems("t1", MasterFileType.DHC_REFERENCE, null);
    expect(result).toEqual({ masterFile: null, items: [] });
    expect(masterFileFindFirst).toHaveBeenCalledWith({
      where: {
        tenantId: "t1",
        type: MasterFileType.DHC_REFERENCE,
        status: MasterFileStatus.PARSED,
        isActive: true,
        customerCompanyId: null,
      },
      orderBy: { uploadedAt: "desc" },
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

  it("parseDhcItems parses Excel header/carry-forward groups and serial W.E.F date", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["DHC Listing rate on Mar 2026"],
      ["Yard", "Old", "New", "Software", "Op Code", "Operator Name", "W.E.F"],
      ["Allied 2", 71, 80, "CMS +$5 Admin Fee", "HY", "HYUNDAI MERCHANT MARINE", 45839],
      ["", "", "", "", "KM", "KOREA MARINE TRANSPORT CO LTD", ""],
      ["Jurong Port", 72, 81, "CMS +$5 Admin Fee", "MSC", "MEDITERRANEAN SHIPPING CO", 45870],
      ["", "", "", "", "", "", ""],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Table 1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const prisma: any = {};
    const supabase: any = { getClient: jest.fn() };
    const svc = new MasterDataService(prisma, supabase);

    const parsed = await (svc as any).parseDhcItems({
      originalname: "dhc.xlsx",
      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(buf),
    });

    expect(parsed.status).toBe(MasterFileStatus.PARSED);
    expect(parsed.items).toHaveLength(3);
    expect(parsed.items.map((i: any) => i.operatorCode)).toEqual(["HY", "KM", "MSC"]);
    expect(parsed.items.map((i: any) => i.yardDepot)).toEqual([
      "Allied 2",
      "Allied 2",
      "Jurong Port",
    ]);
    expect(parsed.items.map((i: any) => i.sortOrder)).toEqual([0, 1, 2]);
    expect(parsed.items[0]).toMatchObject({
      oldRateCents: 7100,
      newRateCents: 8000,
      software: "CMS +$5 Admin Fee",
    });
    expect(parsed.items[1]).toMatchObject({
      oldRateCents: 7100,
      newRateCents: 8000,
    });
    expect(parsed.items[0].effectiveDate).toBeInstanceOf(Date);
    expect(parsed.summary).toMatchObject({
      parserVersion: "dhc_excel_v1",
      parsedRows: 3,
      headerRow: 2,
    });
  });

  it("uploadAndParseMasterFile keeps PARSE_FAILED DHC upload inactive", async () => {
    const masterFileUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const masterFileCreate = jest.fn().mockResolvedValue({
      id: "mf-failed",
      tenantId: "t1",
      type: MasterFileType.DHC_REFERENCE,
      status: MasterFileStatus.PARSE_FAILED,
      isActive: false,
    });
    const dhcCreateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma: any = {
      $transaction: jest.fn(async (fn: any) =>
        fn({
          masterFile: { updateMany: masterFileUpdateMany, create: masterFileCreate },
          customerQuotationItem: { createMany: jest.fn() },
          driverPayoutItem: { createMany: jest.fn() },
          dhcReferenceItem: { createMany: dhcCreateMany },
        }),
      ),
    };
    const supabase: any = { getClient: jest.fn() };
    const svc = new MasterDataService(prisma, supabase);
    jest.spyOn(svc as any, "uploadMasterObject").mockResolvedValue(undefined);
    jest.spyOn(svc as any, "parseDhcItems").mockResolvedValue({
      items: [],
      summary: { parsedRows: 0, parserVersion: "dhc_excel_v1" },
      status: MasterFileStatus.PARSE_FAILED,
    });

    await svc.uploadAndParseMasterFile(
      "t1",
      MasterFileType.DHC_REFERENCE,
      {
        originalname: "dhc.xlsx",
        mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from("x"),
      } as any,
      null,
      null,
      null,
    );

    expect(masterFileUpdateMany).not.toHaveBeenCalled();
    expect(masterFileCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "t1",
        type: MasterFileType.DHC_REFERENCE,
        status: MasterFileStatus.PARSE_FAILED,
        isActive: false,
      }),
    });
    expect(dhcCreateMany).not.toHaveBeenCalled();
  });

  it("replaceQuotationMasterFileItems updates QUOTATION parsed rows", async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({
        id: "mf-q",
        type: MasterFileType.QUOTATION,
        tenantId: "t1",
      })
      .mockResolvedValueOnce({
        id: "mf-q",
        tenantId: "t1",
        type: MasterFileType.QUOTATION,
        isActive: true,
        uploadedAt: new Date(),
      });
    const prisma: any = {
      masterFile: {
        findFirst,
        update: jest.fn().mockResolvedValue({}),
      },
      customerQuotationItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ id: "i1", code: "A1", label: "Haulage" }]),
      },
      driverPayoutItem: { findMany: jest.fn() },
      dhcReferenceItem: { findMany: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const supabase: any = { getClient: jest.fn() };
    const svc = new MasterDataService(prisma, supabase);

    const result = await svc.replaceQuotationMasterFileItems("t1", "mf-q", [
      { code: "A1", label: "Haulage", rateCents: 10000 },
    ]);

    expect(prisma.customerQuotationItem.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", masterFileId: "mf-q" },
    });
    expect(prisma.customerQuotationItem.createMany).toHaveBeenCalled();
    expect(result.masterFile?.id).toBe("mf-q");
  });

  it("activateMasterFile rejects PARSE_FAILED DHC master", async () => {
    const prisma: any = {
      masterFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "mf-failed",
          tenantId: "t1",
          type: MasterFileType.DHC_REFERENCE,
          status: MasterFileStatus.PARSE_FAILED,
          customerCompanyId: null,
        }),
      },
      $transaction: jest.fn(),
    };
    const supabase: any = { getClient: jest.fn() };
    const svc = new MasterDataService(prisma, supabase);

    await expect(svc.activateMasterFile("t1", "mf-failed")).rejects.toThrow(
      "Cannot activate a DHC reference file that has no parsed rows.",
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("activateMasterFile rejects DHC master with parsed status but zero rows", async () => {
    const prisma: any = {
      masterFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "mf-empty",
          tenantId: "t1",
          type: MasterFileType.DHC_REFERENCE,
          status: MasterFileStatus.PARSED,
          customerCompanyId: null,
        }),
      },
      dhcReferenceItem: {
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn(),
    };
    const supabase: any = { getClient: jest.fn() };
    const svc = new MasterDataService(prisma, supabase);

    await expect(svc.activateMasterFile("t1", "mf-empty")).rejects.toThrow(
      "Cannot activate a DHC reference file that has no parsed rows.",
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

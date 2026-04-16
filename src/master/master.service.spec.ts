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
});

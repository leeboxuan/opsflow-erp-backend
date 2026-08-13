import { BadRequestException, ConflictException } from "@nestjs/common";
import { MasterRateDatasetStatus, MasterRateDatasetType } from "@prisma/client";
import { MasterDataService } from "./master.service";

function buildQuotationXlsxBuffer() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const XLSX = require("xlsx");
  const wb = XLSX.utils.book_new();
  const rows: any[] = [];
  rows.push(["Annex A"]);
  rows.push(["A", "SECTION A"]);
  for (let i = 1; i <= 8; i++) {
    rows.push([String(i), `Item A${i}`, `$${i}.00`]);
  }
  rows.push(["B", "SECTION B"]);
  for (let i = 1; i <= 14; i++) {
    rows.push([String(i), `Item B${i}`, `$${i}.00`]);
  }
  rows.push(["Annex B"]);
  rows.push(["C", "SECTION C"]);
  for (let i = 1; i <= 5; i++) {
    rows.push([String(i), `Item C${i}`, `$${i}.00`]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Annex A");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

describe("MasterDataService base quotation template versioning", () => {
  function makePrismaForCreateVersion(opts?: {
    latestVersionNo?: number | null;
    created?: { id: string; versionNo: number; isCurrent?: boolean };
  }) {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const create = jest.fn().mockResolvedValue(
      opts?.created ?? { id: "ds-new", versionNo: 2, isCurrent: true },
    );
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn().mockImplementation(async (args: any) => {
      if (args?.select?.versionNo === true) {
        return opts?.latestVersionNo == null
          ? null
          : { versionNo: opts.latestVersionNo };
      }
      return null;
    });
    const prisma: any = {
      masterRateDataset: { findFirst, updateMany, create },
      masterRateDatasetRow: { createMany, findMany: jest.fn().mockResolvedValue([]) },
      masterFile: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: "mf1" }),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    return { prisma, updateMany, create, createMany };
  }

  it("manual save creates NEW dataset version (new id), previous not current", async () => {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const { prisma, updateMany, create, createMany } = makePrismaForCreateVersion({
      latestVersionNo: 1,
      created: { id: "ds2", versionNo: 2, isCurrent: true },
    });

    // findPreferredDataset: isCurrent first
    prisma.masterRateDataset.findFirst = jest
      .fn()
      .mockResolvedValueOnce({
        id: "ds1",
        versionNo: 1,
        isCurrent: true,
        sourceFileName: "base.xlsx",
        type: MasterRateDatasetType.QUOTATION,
        status: MasterRateDatasetStatus.ACTIVE,
      })
      // createDatasetVersionWithRows: latest versionNo
      .mockResolvedValueOnce({ versionNo: 1 })
      // listQuotationDatasetItems → findPreferredDataset isCurrent
      .mockResolvedValue({
        id: "ds2",
        versionNo: 2,
        isCurrent: true,
        type: MasterRateDatasetType.QUOTATION,
        status: MasterRateDatasetStatus.ACTIVE,
      });

    prisma.masterRateDatasetRow.findMany = jest
      .fn()
      .mockResolvedValueOnce([{ code: "OLD", label: "Old", sortOrder: 0 }])
      .mockResolvedValue([
        {
          id: "r1",
          code: "NEW",
          label: "New",
          rateCents: 1000,
          metadataJson: { annex: "A" },
          isActive: true,
          sortOrder: 0,
        },
      ]);
    prisma.masterRateDataset.updateMany = updateMany;
    prisma.masterRateDataset.create = create;
    prisma.masterRateDatasetRow.createMany = createMany;

    const svc = new MasterDataService(prisma, {} as any, audit as any);
    const ok = await svc.replaceQuotationDatasetItems(
      "t1",
      [{ code: "NEW", label: "New", rateCents: 1000, metadataJson: { annex: "A" } }],
      "u1",
      1,
    );

    expect(ok.dataset?.id).toBe("ds2");
    expect(ok.dataset?.id).not.toBe("ds1");
    expect(ok.dataset?.versionNo).toBe(2);
    expect(ok.dataset?.isCurrent).toBe(true);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isCurrent: true }),
        data: { isCurrent: false },
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isCurrent: true,
          status: MasterRateDatasetStatus.ACTIVE,
          sourceFileName: "base.xlsx",
          versionNo: 2,
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      "t1",
      "UPDATE",
      "MasterRateDataset",
      "ds2",
      expect.objectContaining({
        action: "SAVE_BASE_QUOTATION_TEMPLATE",
        fromVersionNo: 1,
        toVersionNo: 2,
        previousDatasetId: "ds1",
        newDatasetId: "ds2",
      }),
      "u1",
    );
  });

  it("rejects stale expectedVersionNo on concurrent replace", async () => {
    const prisma: any = {
      masterRateDataset: {
        findFirst: jest.fn().mockResolvedValue({
          id: "ds1",
          versionNo: 3,
          isCurrent: true,
          sourceFileName: null,
        }),
      },
      masterRateDatasetRow: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    const svc = new MasterDataService(prisma, {} as any, { log: jest.fn() } as any);
    await expect(
      svc.replaceQuotationDatasetItems(
        "t1",
        [{ code: "NEW", label: "New", rateCents: 1000 }],
        "u1",
        1,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("first import creates isCurrent template without confirmReplace", async () => {
    const { prisma, create, updateMany } = makePrismaForCreateVersion({
      latestVersionNo: null,
      created: { id: "ds1", versionNo: 1, isCurrent: true },
    });
    // No current template
    prisma.masterRateDataset.findFirst = jest
      .fn()
      .mockResolvedValueOnce(null) // isCurrent
      .mockResolvedValueOnce(null) // ACTIVE
      .mockResolvedValueOnce(null) // any latest (findPreferred)
      .mockResolvedValueOnce(null) // latest versionNo in create
      .mockResolvedValue({
        id: "ds1",
        versionNo: 1,
        isCurrent: true,
        type: MasterRateDatasetType.QUOTATION,
        status: MasterRateDatasetStatus.ACTIVE,
      });
    prisma.masterRateDataset.updateMany = updateMany;
    prisma.masterRateDataset.create = create;
    prisma.masterRateDatasetRow.findMany = jest.fn().mockResolvedValue([
      { id: "r1", code: "A_1", label: "Item A1", rateCents: 100, isActive: true },
    ]);

    const svc = new MasterDataService(prisma, {} as any, { log: jest.fn() } as any);
    jest.spyOn(svc as any, "uploadMasterObject").mockResolvedValue(undefined);

    const result = await svc.importQuotationDataset(
      "t1",
      {
        originalname: "quotation.xlsx",
        mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: buildQuotationXlsxBuffer(),
      } as any,
    );

    expect(result.importedCount).toBeGreaterThan(0);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isCurrent: true, versionNo: 1 }),
      }),
    );
  });

  it("second import without confirm fails; with confirm replaces and clears prior isCurrent", async () => {
    const current = {
      id: "ds1",
      versionNo: 1,
      isCurrent: true,
      sourceFileName: "old.xlsx",
      type: MasterRateDatasetType.QUOTATION,
      status: MasterRateDatasetStatus.ACTIVE,
    };
    const { prisma, create, updateMany } = makePrismaForCreateVersion({
      latestVersionNo: 1,
      created: { id: "ds2", versionNo: 2, isCurrent: true },
    });

    const svc = new MasterDataService(prisma, {} as any, { log: jest.fn() } as any);
    jest.spyOn(svc as any, "uploadMasterObject").mockResolvedValue(undefined);

    prisma.masterRateDataset.findFirst = jest.fn().mockResolvedValue(current);
    await expect(
      svc.importQuotationDataset(
        "t1",
        {
          originalname: "quotation.xlsx",
          mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: buildQuotationXlsxBuffer(),
        } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.masterRateDataset.findFirst = jest
      .fn()
      .mockResolvedValueOnce(current) // findPreferred before write
      .mockResolvedValueOnce({ versionNo: 1 }) // createDatasetVersionWithRows latest
      .mockResolvedValue({
        id: "ds2",
        versionNo: 2,
        isCurrent: true,
        type: MasterRateDatasetType.QUOTATION,
        status: MasterRateDatasetStatus.ACTIVE,
      });
    prisma.masterRateDataset.updateMany = updateMany;
    prisma.masterRateDataset.create = create;
    prisma.masterRateDatasetRow.findMany = jest.fn().mockResolvedValue([]);

    const replaced = await svc.importQuotationDataset(
      "t1",
      {
        originalname: "quotation.xlsx",
        mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: buildQuotationXlsxBuffer(),
      } as any,
      "u1",
      { confirmReplace: true, expectedVersionNo: 1 },
    );

    expect(replaced.summary.datasetId).toBe("ds2");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isCurrent: true }),
        data: { isCurrent: false },
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isCurrent: true, versionNo: 2 }),
      }),
    );
  });

  it("failed parse leaves current intact (no DB write)", async () => {
    const prisma: any = {
      masterRateDataset: {
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      masterRateDatasetRow: { createMany: jest.fn() },
      masterFile: { create: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn(),
    };
    const svc = new MasterDataService(prisma, {} as any, { log: jest.fn() } as any);
    const uploadSpy = jest
      .spyOn(svc as any, "uploadMasterObject")
      .mockResolvedValue(undefined);

    await expect(
      svc.importQuotationDataset("t1", {
        originalname: "quotation.pdf",
        mimetype: "application/pdf",
        buffer: Buffer.from("x"),
      } as any),
    ).rejects.toThrow("Quotation import must be Excel (.xlsx/.xls)");

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(prisma.masterRateDataset.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("createDatasetVersionWithRows clears other isCurrent flags", async () => {
    const { prisma, updateMany, create } = makePrismaForCreateVersion({
      latestVersionNo: 2,
      created: { id: "ds3", versionNo: 3, isCurrent: true },
    });
    const svc = new MasterDataService(prisma, {} as any, { log: jest.fn() } as any);

    await (svc as any).createDatasetVersionWithRows(
      "t1",
      MasterRateDatasetType.QUOTATION,
      [{ code: "A", label: "A", isActive: true }],
      "u1",
      "file.xlsx",
    );

    expect(updateMany.mock.calls[0][0]).toEqual({
      where: {
        tenantId: "t1",
        type: MasterRateDatasetType.QUOTATION,
        isCurrent: true,
      },
      data: { isCurrent: false },
    });
    expect(updateMany.mock.calls[1][0]).toEqual({
      where: {
        tenantId: "t1",
        type: MasterRateDatasetType.QUOTATION,
        status: MasterRateDatasetStatus.ACTIVE,
      },
      data: { status: MasterRateDatasetStatus.DRAFT },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isCurrent: true, versionNo: 3 }),
      }),
    );
  });

  it("restore creates new current copied from history; old record stays non-current", async () => {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const historical = {
      id: "ds-old",
      versionNo: 1,
      isCurrent: false,
      sourceFileName: "v1.xlsx",
      type: MasterRateDatasetType.QUOTATION,
      status: MasterRateDatasetStatus.DRAFT,
      rows: [
        {
          code: "A1",
          label: "Haulage",
          section: "A",
          description: null,
          category: null,
          unit: null,
          containerSize: null,
          tripMode: null,
          areaScope: null,
          currency: "SGD",
          rateCents: 1000,
          rawRateText: null,
          requiresManualAmount: false,
          hasMultipleRates: false,
          rateOptionsJson: null,
          defaultRateOptionIndex: null,
          notes: null,
          sortOrder: 0,
          isActive: true,
          metadataJson: { annex: "A" },
        },
      ],
    };
    const current = {
      id: "ds-cur",
      versionNo: 2,
      isCurrent: true,
      sourceFileName: "v2.xlsx",
      type: MasterRateDatasetType.QUOTATION,
      status: MasterRateDatasetStatus.ACTIVE,
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const create = jest.fn().mockResolvedValue({
      id: "ds-new",
      versionNo: 3,
      isCurrent: true,
    });
    const createMany = jest.fn().mockResolvedValue({ count: 1 });

    const prisma: any = {
      masterRateDataset: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(historical) // load historical
          .mockResolvedValueOnce(current) // findPreferred current
          .mockResolvedValueOnce({ versionNo: 2 }) // create latest
          .mockResolvedValue({
            id: "ds-new",
            versionNo: 3,
            isCurrent: true,
            type: MasterRateDatasetType.QUOTATION,
            status: MasterRateDatasetStatus.ACTIVE,
          }),
        updateMany,
        create,
      },
      masterRateDatasetRow: {
        createMany,
        findMany: jest.fn().mockResolvedValue(historical.rows),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          masterRateDataset: {
            findFirst: jest.fn().mockResolvedValue({ versionNo: 2 }),
            updateMany,
            create,
          },
          masterRateDatasetRow: { createMany },
        }),
      ),
    };

    const svc = new MasterDataService(prisma, {} as any, audit as any);
    const result = await svc.restoreQuotationTemplateVersion(
      "t1",
      "ds-old",
      "u1",
      2,
    );

    expect(result.dataset.id).toBe("ds-new");
    expect(result.dataset.isCurrent).toBe(true);
    expect(result.dataset.restoredFromDatasetId).toBe("ds-old");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isCurrent: true,
          sourceFileName: "v1.xlsx (restored from v1)",
        }),
      }),
    );
    // Historical record is never flipped to isCurrent=true in-place
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "ds-old" }),
        data: expect.objectContaining({ isCurrent: true }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      "t1",
      "CREATE",
      "MasterRateDataset",
      "ds-new",
      expect.objectContaining({
        action: "RESTORE_BASE_QUOTATION_TEMPLATE",
        restoredFromVersionNo: 1,
      }),
      "u1",
    );
  });
});

describe("MasterDataService quotation line-item mutations", () => {
  const currentRow = {
    id: "row-1",
    tenantId: "t1",
    datasetId: "ds1",
    code: "TRK-01",
    label: "Trucking",
    section: "ANNEX A",
    description: "Haulage",
    category: "Transport",
    unit: "trip",
    containerSize: "20",
    tripMode: "IMPORT",
    areaScope: null,
    currency: "SGD",
    rateCents: 10000,
    rawRateText: null,
    requiresManualAmount: false,
    notes: null,
    sortOrder: 0,
    isActive: true,
    metadataJson: { annex: "A" },
  };

  function makePrismaForItemMutation(opts?: { currentRows?: any[] }) {
    const currentRows = opts?.currentRows ?? [currentRow];
    let versionCreated = false;
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const create = jest.fn().mockImplementation(async () => {
      versionCreated = true;
      return { id: "ds2", versionNo: 2, isCurrent: true };
    });
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma: any = {
      masterRateDataset: {
        findFirst: jest.fn().mockImplementation(async (args: any) => {
          if (args?.select?.versionNo === true) {
            return { versionNo: 1 };
          }
          if (args?.where?.tenantId && args.where.tenantId !== "t1") {
            return null;
          }
          const id = versionCreated ? "ds2" : "ds1";
          return {
            id,
            versionNo: versionCreated ? 2 : 1,
            isCurrent: true,
            sourceFileName: "base.xlsx",
            type: MasterRateDatasetType.QUOTATION,
            status: MasterRateDatasetStatus.ACTIVE,
          };
        }),
        updateMany,
        create,
      },
      masterRateDatasetRow: {
        findMany: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.tenantId && args.where.tenantId !== "t1") {
            return [];
          }
          if (args?.select?.code) {
            return currentRows.map((r) => ({
              code: r.code,
              label: r.label,
              sortOrder: r.sortOrder,
            }));
          }
          if (versionCreated) {
            return [
              ...currentRows.map((r) => ({ ...r, datasetId: "ds2" })),
              {
                id: "row-new",
                code: "NEW-01",
                label: "New line",
                rateCents: 2500,
                isActive: true,
                sortOrder: 1,
                metadataJson: null,
              },
            ];
          }
          return currentRows;
        }),
        createMany,
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      customerRateTemplate: { update: jest.fn(), delete: jest.fn() },
      customerRateTemplateRow: { update: jest.fn(), deleteMany: jest.fn() },
      customerQuotation: { update: jest.fn() },
      customerQuotationLine: { update: jest.fn(), deleteMany: jest.fn() },
    };
    return { prisma, updateMany, create, createMany };
  }

  it("lists current quotation base rows for the tenant", async () => {
    const { prisma } = makePrismaForItemMutation();
    const svc = new MasterDataService(prisma, {} as any, { log: jest.fn() } as any);
    const rows = await svc.listQuotationDatasetItems("t1");
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("TRK-01");
    expect(prisma.masterRateDataset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t1",
          type: MasterRateDatasetType.QUOTATION,
          isCurrent: true,
        }),
      }),
    );
    expect(prisma.masterRateDatasetRow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "t1", datasetId: "ds1" },
      }),
    );
  });

  it("does not list another tenant's quotation rows", async () => {
    const { prisma } = makePrismaForItemMutation();
    const svc = new MasterDataService(prisma, {} as any, { log: jest.fn() } as any);
    const rows = await svc.listQuotationDatasetItems("t-other");
    expect(rows).toEqual([]);
    expect(prisma.masterRateDataset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "t-other" }),
      }),
    );
  });

  it("creates a line item as a new version", async () => {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const { prisma, create, createMany } = makePrismaForItemMutation();
    const svc = new MasterDataService(prisma, {} as any, audit as any);
    const ok = await svc.createQuotationDatasetItem(
      "t1",
      { code: "NEW-01", label: "New line", rateCents: 2500 },
      "u1",
      1,
    );
    expect(ok.dataset?.versionNo).toBe(2);
    expect(ok.dataset?.id).toBe("ds2");
    expect(create).toHaveBeenCalled();
    expect(createMany).toHaveBeenCalled();
    const saved = createMany.mock.calls[0][0].data;
    expect(saved.some((r: any) => r.code === "TRK-01")).toBe(true);
    expect(saved.some((r: any) => r.code === "NEW-01")).toBe(true);
  });

  it("updates a line item as a new version without touching customer snapshots", async () => {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const { prisma, createMany } = makePrismaForItemMutation();
    const svc = new MasterDataService(prisma, {} as any, audit as any);
    await svc.updateQuotationDatasetItem(
      "t1",
      "row-1",
      { code: "TRK-01", label: "Trucking updated", rateCents: 12000 },
      "u1",
      1,
    );
    const saved = createMany.mock.calls[0][0].data;
    expect(saved[0].label).toBe("Trucking updated");
    expect(saved[0].rateCents).toBe(12000);
    expect(prisma.customerRateTemplate.update).not.toHaveBeenCalled();
    expect(prisma.customerRateTemplateRow.update).not.toHaveBeenCalled();
    expect(prisma.customerQuotation.update).not.toHaveBeenCalled();
    expect(prisma.customerQuotationLine.update).not.toHaveBeenCalled();
  });

  it("deletes a line item as a new version without deleting customer copied rows", async () => {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const { prisma, create, createMany } = makePrismaForItemMutation();
    const svc = new MasterDataService(prisma, {} as any, audit as any);
    const ok = await svc.deleteQuotationDatasetItem("t1", "row-1", "u1", 1);
    expect(ok.dataset?.id).toBe("ds2");
    expect(create).toHaveBeenCalled();
    // Sole remaining row was removed, so the new version has zero rows.
    expect(createMany).not.toHaveBeenCalled();
    expect(prisma.customerRateTemplateRow.deleteMany).not.toHaveBeenCalled();
    expect(prisma.customerQuotationLine.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects update/delete of a missing line item", async () => {
    const { prisma } = makePrismaForItemMutation();
    const svc = new MasterDataService(prisma, {} as any, { log: jest.fn() } as any);
    await expect(
      svc.updateQuotationDatasetItem(
        "t1",
        "row-missing",
        { code: "X", label: "X" },
        "u1",
        1,
      ),
    ).rejects.toThrow("Line item not found");
    await expect(
      svc.deleteQuotationDatasetItem("t1", "row-missing", "u1", 1),
    ).rejects.toThrow("Line item not found");
  });

  it("rejects validation failures on create", async () => {
    const { prisma } = makePrismaForItemMutation();
    const svc = new MasterDataService(prisma, {} as any, { log: jest.fn() } as any);
    await expect(
      svc.createQuotationDatasetItem("t1", { code: "", label: "X" }, "u1", 1),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.createQuotationDatasetItem(
        "t1",
        { code: "X", label: "X", rateCents: -1 },
        "u1",
        1,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("Excel replacement returns the new current rows", async () => {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const { prisma } = makePrismaForItemMutation();
    const svc = new MasterDataService(prisma, {} as any, audit as any);
    const ok = await svc.replaceQuotationDatasetItems(
      "t1",
      [{ code: "NEW-01", label: "New line", rateCents: 2500 }],
      "u1",
      1,
    );
    expect(ok.dataset?.isCurrent).toBe(true);
    expect(ok.dataset?.versionNo).toBe(2);
    expect(ok.items.some((r: any) => r.code === "NEW-01")).toBe(true);
  });
});

import { BadRequestException, ConflictException } from "@nestjs/common";
import { MasterRateDatasetStatus, MasterRateDatasetType } from "@prisma/client";
import { MasterDataService } from "./master.service";

function buildTruckingXlsxBuffer() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const XLSX = require("xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["code", "label", "amount", "currency", "active"],
    ["TRIP-A", "Trip A", "18.00", "SGD", "true"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

function buildDhcXlsxBuffer() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const XLSX = require("xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Yard", "Old", "New", "Software", "Op Code", "Operator Name", "W.E.F"],
    ["Allied", 71, 80, "CMS", "HY", "HYUNDAI", 45839],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Table 1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

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
    masterRateDataset: { findFirst, updateMany, create, findMany: jest.fn().mockResolvedValue([]) },
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

describe.each([
  {
    type: MasterRateDatasetType.DHC_RATES,
    label: "DHC_RATES",
    buildBuffer: buildDhcXlsxBuffer,
    fileName: "dhc.xlsx",
    importFn: "importDhcRatesDataset" as const,
    replaceFn: "replaceDhcRatesDataset" as const,
    restoreFn: "restoreDhcRatesTemplateVersion" as const,
  },
  {
    type: MasterRateDatasetType.TRUCKING_RATES,
    label: "TRUCKING_RATES",
    buildBuffer: buildTruckingXlsxBuffer,
    fileName: "trucking.xlsx",
    importFn: "importTruckingRatesDataset" as const,
    replaceFn: "replaceDriverTripRateMasters" as const,
    restoreFn: "restoreTruckingRatesTemplateVersion" as const,
  },
])("MasterDataService $label template versioning", (cfg) => {
  it("first import creates isCurrent template without confirmReplace", async () => {
    const { prisma, create, updateMany } = makePrismaForCreateVersion({
      latestVersionNo: null,
      created: { id: "ds1", versionNo: 1, isCurrent: true },
    });
    prisma.masterRateDataset.findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: "ds1",
        versionNo: 1,
        isCurrent: true,
        type: cfg.type,
        status: MasterRateDatasetStatus.ACTIVE,
      });
    prisma.masterRateDataset.updateMany = updateMany;
    prisma.masterRateDataset.create = create;
    prisma.masterRateDatasetRow.findMany = jest.fn().mockResolvedValue([
      { id: "r1", code: "A1", label: "Item", rateCents: 100, isActive: true },
    ]);

    const svc = new MasterDataService(prisma, {} as any, { log: jest.fn() } as any);
    jest.spyOn(svc as any, "uploadMasterObject").mockResolvedValue(undefined);

    const result = await (svc as any)[cfg.importFn]("t1", {
      originalname: cfg.fileName,
      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: cfg.buildBuffer(),
    } as any);

    expect(result.importedCount ?? result.items?.length).toBeGreaterThan(0);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isCurrent: true,
          versionNo: 1,
          type: cfg.type,
          tenantId: "t1",
        }),
      }),
    );
  });

  it("second import requires confirmReplace; with confirm clears prior isCurrent", async () => {
    const current = {
      id: "ds1",
      versionNo: 1,
      isCurrent: true,
      sourceFileName: "old.xlsx",
      type: cfg.type,
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
      (svc as any)[cfg.importFn]("t1", {
        originalname: cfg.fileName,
        mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: cfg.buildBuffer(),
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.masterRateDataset.findFirst = jest
      .fn()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ versionNo: 1 })
      .mockResolvedValue({
        id: "ds2",
        versionNo: 2,
        isCurrent: true,
        type: cfg.type,
        status: MasterRateDatasetStatus.ACTIVE,
      });
    prisma.masterRateDataset.updateMany = updateMany;
    prisma.masterRateDataset.create = create;
    prisma.masterRateDatasetRow.findMany = jest.fn().mockResolvedValue([]);

    const replaced = await (svc as any)[cfg.importFn](
      "t1",
      {
        originalname: cfg.fileName,
        mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: cfg.buildBuffer(),
      } as any,
      "u1",
      { confirmReplace: true, expectedVersionNo: 1 },
    );

    expect(replaced.summary.datasetId).toBe("ds2");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t1",
          type: cfg.type,
          isCurrent: true,
        }),
        data: { isCurrent: false },
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isCurrent: true,
          versionNo: 2,
          type: cfg.type,
          tenantId: "t1",
        }),
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
      (svc as any)[cfg.importFn]("t1", {
        originalname: "bad.pdf",
        mimetype: "application/pdf",
        buffer: Buffer.from("x"),
      } as any),
    ).rejects.toThrow(/must be Excel/);

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(prisma.masterRateDataset.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("manual save creates new version id", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const create = jest.fn().mockResolvedValue({
      id: "ds2",
      versionNo: 2,
      isCurrent: true,
    });
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma: any = {
      masterRateDataset: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "ds1",
            versionNo: 1,
            isCurrent: true,
            sourceFileName: "base.xlsx",
            type: cfg.type,
            status: MasterRateDatasetStatus.ACTIVE,
          })
          .mockResolvedValue({
            id: "ds2",
            versionNo: 2,
            isCurrent: true,
            type: cfg.type,
            status: MasterRateDatasetStatus.ACTIVE,
          }),
        updateMany,
        create,
      },
      masterRateDatasetRow: {
        createMany,
        findMany: jest.fn().mockResolvedValue([
          {
            id: "r1",
            code: "NEW",
            label: "New",
            rateCents: null,
            isActive: true,
            requiresManualAmount: true,
          },
        ]),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          masterRateDataset: {
            findFirst: jest.fn().mockResolvedValue({ versionNo: 1 }),
            updateMany,
            create,
          },
          masterRateDatasetRow: { createMany },
        }),
      ),
    };
    const svc = new MasterDataService(prisma, {} as any, { log: jest.fn() } as any);
    const ok = await (svc as any)[cfg.replaceFn](
      "t1",
      [{ code: "NEW", label: "New", amountCents: null, requiresManualAmount: true }],
      "u1",
      1,
    );

    expect(ok.dataset?.id).toBe("ds2");
    expect(ok.dataset?.id).not.toBe("ds1");
    expect(ok.dataset?.versionNo).toBe(2);
    expect(ok.dataset?.isCurrent).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: cfg.type,
          tenantId: "t1",
          isCurrent: true,
          sourceFileName: "base.xlsx",
        }),
      }),
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
          type: cfg.type,
        }),
      },
      masterRateDatasetRow: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    const svc = new MasterDataService(prisma, {} as any, { log: jest.fn() } as any);
    await expect(
      (svc as any)[cfg.replaceFn](
        "t1",
        [{ code: "NEW", label: "New", amountCents: 1000 }],
        "u1",
        1,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("restore creates new current; historical stays non-current", async () => {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const historical = {
      id: "ds-old",
      versionNo: 1,
      isCurrent: false,
      sourceFileName: "v1.xlsx",
      type: cfg.type,
      status: MasterRateDatasetStatus.DRAFT,
      rows: [
        {
          code: "A1",
          label: "Item",
          section: null,
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
          metadataJson: null,
        },
      ],
    };
    const current = {
      id: "ds-cur",
      versionNo: 2,
      isCurrent: true,
      sourceFileName: "v2.xlsx",
      type: cfg.type,
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
          .mockResolvedValueOnce(historical)
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce({ versionNo: 2 })
          .mockResolvedValue({
            id: "ds-new",
            versionNo: 3,
            isCurrent: true,
            type: cfg.type,
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
    const result = await (svc as any)[cfg.restoreFn]("t1", "ds-old", "u1", 2);

    expect(result.dataset.id).toBe("ds-new");
    expect(result.dataset.isCurrent).toBe(true);
    expect(result.dataset.restoredFromDatasetId).toBe("ds-old");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: cfg.type,
          tenantId: "t1",
          isCurrent: true,
        }),
      }),
    );
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "ds-old" }),
        data: expect.objectContaining({ isCurrent: true }),
      }),
    );
  });
});

describe("MasterDataService DHC vs TRUCKING isolation", () => {
  it("replacing DHC does not touch TRUCKING current (and vice versa)", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const create = jest.fn().mockResolvedValue({
      id: "ds-dhc-2",
      versionNo: 2,
      isCurrent: true,
    });
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma: any = {
      masterRateDataset: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "ds-dhc-1",
            versionNo: 1,
            isCurrent: true,
            sourceFileName: "dhc.xlsx",
            type: MasterRateDatasetType.DHC_RATES,
            status: MasterRateDatasetStatus.ACTIVE,
          })
          .mockResolvedValue({
            id: "ds-dhc-2",
            versionNo: 2,
            isCurrent: true,
            type: MasterRateDatasetType.DHC_RATES,
            status: MasterRateDatasetStatus.ACTIVE,
          }),
        updateMany,
        create,
      },
      masterRateDatasetRow: {
        createMany,
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          masterRateDataset: {
            findFirst: jest.fn().mockResolvedValue({ versionNo: 1 }),
            updateMany,
            create,
          },
          masterRateDatasetRow: { createMany },
        }),
      ),
    };
    const svc = new MasterDataService(prisma, {} as any, { log: jest.fn() } as any);

    await svc.replaceDhcRatesDataset(
      "t1",
      [{ code: "D1", label: "DHC", amountCents: 100 }],
      "u1",
      1,
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t1",
          type: MasterRateDatasetType.DHC_RATES,
          isCurrent: true,
        }),
      }),
    );
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: MasterRateDatasetType.TRUCKING_RATES,
        }),
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: MasterRateDatasetType.DHC_RATES,
          tenantId: "t1",
        }),
      }),
    );

    updateMany.mockClear();
    create.mockClear();
    create.mockResolvedValue({
      id: "ds-truck-2",
      versionNo: 2,
      isCurrent: true,
    });
    prisma.masterRateDataset.findFirst = jest
      .fn()
      .mockResolvedValueOnce({
        id: "ds-truck-1",
        versionNo: 1,
        isCurrent: true,
        sourceFileName: "truck.xlsx",
        type: MasterRateDatasetType.TRUCKING_RATES,
        status: MasterRateDatasetStatus.ACTIVE,
      })
      .mockResolvedValue({
        id: "ds-truck-2",
        versionNo: 2,
        isCurrent: true,
        type: MasterRateDatasetType.TRUCKING_RATES,
        status: MasterRateDatasetStatus.ACTIVE,
      });

    await svc.replaceDriverTripRateMasters(
      "t1",
      [{ code: "T1", label: "Trip", amountCents: 1800 }],
      "u1",
      1,
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t1",
          type: MasterRateDatasetType.TRUCKING_RATES,
          isCurrent: true,
        }),
      }),
    );
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: MasterRateDatasetType.DHC_RATES,
        }),
      }),
    );
  });

  it("createDatasetVersionWithRows maps amountCents into rateCents", async () => {
    const { prisma, createMany } = makePrismaForCreateVersion({
      latestVersionNo: 0,
      created: { id: "ds1", versionNo: 1, isCurrent: true },
    });
    const svc = new MasterDataService(prisma, {} as any, { log: jest.fn() } as any);
    await (svc as any).createDatasetVersionWithRows(
      "t1",
      MasterRateDatasetType.DHC_RATES,
      [{ code: "X", label: "X", amountCents: 2500, isActive: true }],
      "u1",
      null,
    );
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          tenantId: "t1",
          code: "X",
          rateCents: 2500,
        }),
      ],
    });
  });
});

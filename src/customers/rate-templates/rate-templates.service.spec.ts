import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  CustomerRateTemplateStatus,
  MasterRateDatasetStatus,
  MasterRateDatasetType,
} from "@prisma/client";
import { RateTemplatesService } from "./rate-templates.service";

describe("RateTemplatesService", () => {
  function makeService(prisma: any, audit: any = { log: jest.fn() }) {
    return new RateTemplatesService(prisma, audit);
  }

  it("rejects cross-tenant / missing customer company", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const svc = makeService(prisma);
    await expect(svc.list("t1", "c-other")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("rejects cross-customer template access as NotFound", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerRateTemplate: {
        findFirst: jest.fn().mockResolvedValue({
          id: "tpl1",
          tenantId: "t1",
          customerCompanyId: "c2",
          rows: [],
        }),
      },
    };
    const svc = makeService(prisma);
    await expect(svc.getById("t1", "c1", "tpl1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("from-master creates independent copy with audit source ids only", async () => {
    const masterRows = [
      {
        id: "mr1",
        code: "TRK-01",
        label: "Trucking",
        section: "A",
        description: null,
        category: null,
        unit: "trip",
        containerSize: "20",
        tripMode: null,
        areaScope: null,
        currency: "SGD",
        rateCents: 10000,
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
    ];
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      masterRateDataset: {
        findFirst: jest.fn().mockResolvedValue({
          id: "ds1",
          versionNo: 3,
          type: MasterRateDatasetType.QUOTATION,
          status: MasterRateDatasetStatus.ACTIVE,
          rows: masterRows,
        }),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          customerRateTemplate: {
            create: jest.fn().mockResolvedValue({
              id: "tpl-new",
              tenantId: "t1",
              customerCompanyId: "c1",
              name: "From master",
              sourceMasterDatasetId: "ds1",
              sourceMasterDatasetVersionNo: 3,
            }),
            findFirst: jest.fn().mockResolvedValue({
              id: "tpl-new",
              sourceMasterDatasetId: "ds1",
              sourceMasterDatasetVersionNo: 3,
              rows: [
                {
                  id: "tr1",
                  code: "TRK-01",
                  sourceMasterRowId: "mr1",
                  rateCents: 10000,
                },
              ],
            }),
          },
          customerRateTemplateRow: { createMany },
        }),
      ),
    };
    const audit = { log: jest.fn() };
    const svc = makeService(prisma, audit);

    const res = await svc.createFromMaster(
      "t1",
      "c1",
      { name: "From master" },
      "u1",
    );

    expect(res.id).toBe("tpl-new");
    expect(createMany).toHaveBeenCalled();
    const rowData = createMany.mock.calls[0][0].data[0];
    expect(rowData.sourceMasterRowId).toBe("mr1");
    expect(rowData.rateCents).toBe(10000);
    expect(rowData.code).toBe("TRK-01");
    // Independent copy: new template id, not the master dataset id as row parent
    expect(rowData.templateId).toBe("tpl-new");
    expect(audit.log).toHaveBeenCalled();
  });

  it("replaceRows does not require proving master unchanged", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerRateTemplate: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "tpl1",
            tenantId: "t1",
            customerCompanyId: "c1",
            rows: [{ id: "old", code: "A", label: "Old" }],
          })
          .mockResolvedValueOnce({
            id: "tpl1",
            tenantId: "t1",
            customerCompanyId: "c1",
            rows: [{ id: "new", code: "B", label: "New", rateCents: 500 }],
          }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          customerRateTemplateRow: {
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          customerRateTemplate: {
            update: jest.fn().mockResolvedValue({}),
            findFirst: jest.fn().mockResolvedValue({
              id: "tpl1",
              rows: [{ id: "new", code: "B", label: "New", rateCents: 500 }],
            }),
          },
        }),
      ),
    };
    const svc = makeService(prisma);
    const res = await svc.replaceRows(
      "t1",
      "c1",
      "tpl1",
      [{ code: "B", label: "New", rateCents: 500 }],
      "u1",
    );
    expect(res.rows[0].code).toBe("B");
    // No master dataset read/assert during edit
    expect(prisma.masterRateDataset).toBeUndefined();
  });

  it("duplicate creates DRAFT copy under same customer", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerRateTemplate: {
        findFirst: jest.fn().mockResolvedValue({
          id: "tpl1",
          tenantId: "t1",
          customerCompanyId: "c1",
          name: "Original",
          currency: "SGD",
          effectiveFrom: null,
          effectiveTo: null,
          notes: null,
          sourceMasterDatasetId: "ds1",
          sourceMasterDatasetVersionNo: 2,
          status: CustomerRateTemplateStatus.ACTIVE,
          rows: [
            {
              code: "X",
              label: "Line",
              section: null,
              description: null,
              category: null,
              unit: null,
              containerSize: null,
              tripMode: null,
              areaScope: null,
              currency: "SGD",
              rateCents: 100,
              rawRateText: null,
              requiresManualAmount: false,
              hasMultipleRates: false,
              rateOptionsJson: null,
              defaultRateOptionIndex: null,
              notes: null,
              sortOrder: 0,
              isActive: true,
              metadataJson: null,
              sourceMasterRowId: "mr1",
            },
          ],
        }),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          customerRateTemplate: {
            create: jest.fn().mockResolvedValue({ id: "tpl2" }),
            findFirst: jest.fn().mockResolvedValue({
              id: "tpl2",
              status: CustomerRateTemplateStatus.DRAFT,
              name: "Copy of Original",
              rows: [{ code: "X", sourceMasterRowId: "mr1" }],
            }),
          },
          customerRateTemplateRow: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        }),
      ),
    };
    const svc = makeService(prisma);
    const res = await svc.duplicate("t1", "c1", "tpl1", {}, "u1");
    expect(res.id).toBe("tpl2");
    expect(res.status).toBe(CustomerRateTemplateStatus.DRAFT);
  });

  it("createBlank requires name", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
    };
    const svc = makeService(prisma);
    await expect(
      svc.createBlank("t1", "c1", { name: "  " } as any, "u1"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("seedFromCurrentQuotationBase returns null when no quotation base exists", async () => {
    const prisma: any = {
      masterRateDataset: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const svc = makeService(prisma);
    await expect(
      svc.seedFromCurrentQuotationBase("t1", "c1", "u1", "Acme"),
    ).resolves.toBeNull();
  });

  it("seedFromCurrentQuotationBase looks up the dataset for the caller's tenant only", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma: any = {
      masterRateDataset: { findFirst },
    };
    const svc = makeService(prisma);
    await svc.seedFromCurrentQuotationBase("t1", "c1", "u1", "Acme");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t1",
          type: MasterRateDatasetType.QUOTATION,
          isCurrent: true,
        }),
      }),
    );
    expect(findFirst.mock.calls.every((c: any[]) => c[0].where.tenantId === "t1")).toBe(
      true,
    );
  });

  it("createFromMaster with a transaction client does not nest $transaction or audit early", async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      masterRateDataset: {
        findFirst: jest.fn().mockResolvedValue({
          id: "ds1",
          versionNo: 3,
          type: MasterRateDatasetType.QUOTATION,
          status: MasterRateDatasetStatus.ACTIVE,
          rows: [{ id: "mr1", code: "TRK-01", label: "Trucking", rateCents: 10000 }],
        }),
      },
      customerRateTemplate: {
        create: jest.fn().mockResolvedValue({
          id: "tpl-new",
          tenantId: "t1",
          customerCompanyId: "c1",
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "tpl-new",
          name: "From master",
          sourceMasterDatasetId: "ds1",
          sourceMasterDatasetVersionNo: 3,
          rows: [{ id: "tr1", code: "TRK-01", sourceMasterRowId: "mr1" }],
        }),
      },
      customerRateTemplateRow: { createMany },
    };
    const prisma: any = { $transaction: jest.fn() };
    const audit = { log: jest.fn() };
    const svc = makeService(prisma, audit);

    const res = await svc.createFromMaster(
      "t1",
      "c1",
      { name: "From master" },
      "u1",
      { client: tx },
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(createMany).toHaveBeenCalled();
    expect(res.rows[0].id).toBe("tr1");
    expect(res.rows[0].id).not.toBe("mr1");
    expect(createMany.mock.calls[0][0].data[0].sourceMasterRowId).toBe("mr1");
  });

  it("createFromMaster rejects another tenant's customer company", async () => {
    const tx: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const svc = makeService({ $transaction: jest.fn() });
    await expect(
      svc.createFromMaster("t1", "c-other", { name: "X" }, "u1", { client: tx }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.customer_companies.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c-other", tenantId: "t1" },
      }),
    );
  });

  it("copied customer rows stay independent after later master edits", async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      masterRateDataset: {
        findFirst: jest.fn().mockResolvedValue({
          id: "ds1",
          versionNo: 3,
          type: MasterRateDatasetType.QUOTATION,
          status: MasterRateDatasetStatus.ACTIVE,
          rows: [
            {
              id: "mr1",
              code: "TRK-01",
              label: "Trucking",
              section: "A",
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
              hasMultipleRates: false,
              rateOptionsJson: null,
              defaultRateOptionIndex: null,
              notes: "note",
              sortOrder: 4,
              isActive: true,
              metadataJson: { annex: "A" },
            },
          ],
        }),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          customerRateTemplate: {
            create: jest.fn().mockResolvedValue({
              id: "tpl-new",
              tenantId: "t1",
              customerCompanyId: "c1",
              name: "From master",
              sourceMasterDatasetId: "ds1",
              sourceMasterDatasetVersionNo: 3,
            }),
            findFirst: jest.fn().mockResolvedValue({
              id: "tpl-new",
              name: "From master",
              sourceMasterDatasetId: "ds1",
              sourceMasterDatasetVersionNo: 3,
              rows: [{ id: "tr1", code: "TRK-01", sourceMasterRowId: "mr1" }],
            }),
          },
          customerRateTemplateRow: { createMany },
        }),
      ),
    };
    const svc = makeService(prisma, { log: jest.fn() });
    const res = await svc.createFromMaster(
      "t1",
      "c1",
      { name: "From master" },
      "u1",
    );
    const row = createMany.mock.calls[0][0].data[0];
    expect(row.id).toBeUndefined();
    expect(row.templateId).toBe("tpl-new");
    expect(row.sourceMasterRowId).toBe("mr1");
    expect(row.sortOrder).toBe(4);
    expect(row.section).toBe("A");
    expect(row.metadataJson).toEqual({ annex: "A" });
    expect(res.rows[0].id).toBe("tr1");
    expect(res.rows[0].id).not.toBe("mr1");
  });
});

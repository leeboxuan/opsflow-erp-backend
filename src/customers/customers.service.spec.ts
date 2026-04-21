import { CustomersService } from "./customers.service";
import { QuotationVersionStatus } from "@prisma/client";

describe("CustomersService quotation upload behavior", () => {
  it("uploadCompanyQuotation is record-only and does not parse/sync master tables", async () => {
    const quotationUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const quotationCreate = jest.fn().mockResolvedValue({
      id: "q1",
      storageKey: "t1/companies/c1/quotations/123.pdf",
      originalName: "signed-quotation.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      effectiveDate: null,
      status: QuotationVersionStatus.ACTIVE,
      createdAt: new Date(),
      parsedSummaryJson: { note: "Signed quotation uploaded for record keeping only (no parsing)." },
    });
    const quotationRateLineCreateMany = jest.fn();
    const customerRateMasterLineCreateMany = jest.fn();
    const customerRateMasterLineUpdateMany = jest.fn();

    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1" }),
      },
      customerCompanyQuotation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      customerQuotationRateLine: {
        createMany: quotationRateLineCreateMany,
      },
      customerRateMasterLine: {
        createMany: customerRateMasterLineCreateMany,
        updateMany: customerRateMasterLineUpdateMany,
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          customerCompanyQuotation: {
            updateMany: quotationUpdateMany,
            create: quotationCreate,
          },
          customerQuotationRateLine: {
            createMany: quotationRateLineCreateMany,
          },
          customerRateMasterLine: {
            createMany: customerRateMasterLineCreateMany,
            updateMany: customerRateMasterLineUpdateMany,
          },
        }),
      ),
    };

    const storageUpload = jest.fn().mockResolvedValue({ error: null });
    const storageSign = jest
      .fn()
      .mockResolvedValue({ data: { signedUrl: "https://signed-url" }, error: null });
    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            upload: storageUpload,
            createSignedUrl: storageSign,
          }),
        },
      }),
    };
    const configService: any = {
      get: jest.fn((k: string) => {
        if (k === "SUPABASE_PROJECT_URL" || k === "SUPABASE_URL") return "https://supabase.example";
        if (k === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-key";
        return null;
      }),
    };
    const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
    const svc = new CustomersService(
      prisma,
      supabaseService,
      configService,
      audit,
    );

    const res = await svc.uploadCompanyQuotation(
      "t1",
      "c1",
      {
        originalname: "signed-quotation.pdf",
        mimetype: "application/pdf",
        buffer: Buffer.from("x"),
        size: 10,
      } as any,
      "u1",
      null,
    );

    expect(res.id).toBe("q1");
    expect(quotationUpdateMany).toHaveBeenCalled();
    expect(quotationCreate).toHaveBeenCalled();
    expect(quotationRateLineCreateMany).not.toHaveBeenCalled();
    expect(customerRateMasterLineCreateMany).not.toHaveBeenCalled();
    expect(customerRateMasterLineUpdateMany).not.toHaveBeenCalled();
    expect(storageUpload).toHaveBeenCalled();
  });

  it("uploadCompanyQuotation rejects non-PDF signed quotation files", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1" }),
      },
    };
    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            upload: jest.fn(),
            createSignedUrl: jest.fn(),
          }),
        },
      }),
    };
    const configService: any = {
      get: jest.fn((k: string) => {
        if (k === "SUPABASE_PROJECT_URL" || k === "SUPABASE_URL") return "https://supabase.example";
        if (k === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-key";
        return null;
      }),
    };
    const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
    const svc = new CustomersService(prisma, supabaseService, configService, audit);

    await expect(
      svc.uploadCompanyQuotation(
        "t1",
        "c1",
        {
          originalname: "signed-quotation.docx",
          mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer: Buffer.from("x"),
          size: 10,
        } as any,
        "u1",
        null,
      ),
    ).rejects.toThrow("Signed quotation must be a PDF file");
  });
});

import { JobDocumentType } from "@prisma/client";
import { TransportJobsService } from "./transport-jobs.service";

describe("TransportJobsService document signed URLs", () => {
  it("listDocuments returns metadata without signed URLs", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({ id: "job1", tenantId: "t1", customerCompanyId: "c1" }),
      },
      jobDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "doc1",
            type: JobDocumentType.QUOTATION,
            storageKey: "t1/jobs/job1/q.pdf",
            originalName: "q.pdf",
            mimeType: "application/pdf",
            sizeBytes: 10,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            uploadedByUserId: "u1",
            uploadedByNameSnapshot: "Ops",
            generatedBySystem: false,
            generatedSource: null,
            uploadedBy: { name: "Ops", displayName: null, email: "ops@example.com" },
          },
        ]),
      },
    };
    const supabase = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            createSignedUrl: jest.fn(),
          }),
        },
      }),
    };
    const svc = new TransportJobsService(prisma, { log: jest.fn() } as any, supabase as any);
    const docs = await svc.listDocuments("t1", "job1", { role: "ADMIN", customerCompanyId: null });
    expect(docs[0].previewUrl).toBeNull();
    expect(docs[0].uploadedByName).toBe("Ops");
    expect(supabase.getClient().storage.from).not.toHaveBeenCalled();
  });

  it("getJobDocumentSignedUrl returns cached signed URLs", async () => {
    const createSignedUrl = jest
      .fn()
      .mockResolvedValue({ data: { signedUrl: "https://signed.example/doc" }, error: null });
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({ id: "job1", tenantId: "t1", customerCompanyId: "c1" }),
      },
      jobDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "doc1",
          storageKey: "t1/jobs/job1/q.pdf",
          isActive: true,
        }),
      },
    };
    const supabase = {
      getClient: jest.fn().mockReturnValue({
        storage: { from: jest.fn().mockReturnValue({ createSignedUrl }) },
      }),
    };
    const svc = new TransportJobsService(prisma, { log: jest.fn() } as any, supabase as any);
    const first = await svc.getJobDocumentSignedUrl("t1", "job1", "doc1", {
      role: "ADMIN",
      customerCompanyId: null,
    });
    const second = await svc.getJobDocumentSignedUrl("t1", "job1", "doc1", {
      role: "ADMIN",
      customerCompanyId: null,
    });
    expect(first.previewUrl).toBe("https://signed.example/doc");
    expect(second.previewUrl).toBe("https://signed.example/doc");
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });
});

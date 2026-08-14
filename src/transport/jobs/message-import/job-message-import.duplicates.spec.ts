import { JobType } from "@prisma/client";
import { findDuplicateCandidates, findDuplicateCandidatesForDrafts } from "./job-message-import.duplicates";
import { normalizeReviewedDraft } from "./job-message-import.validator";
import { JobMessageImportMovementType } from "@prisma/client";

describe("findDuplicateCandidates", () => {
  const reviewed = normalizeReviewedDraft({
    movementType: JobMessageImportMovementType.IMPORT,
    customerCompanyId: "c1",
    pickupAddress1: "Tuas",
    deliveryAddress1: "DB",
    items: [{ containerNumber: "GESU6311344", sealNumber: null, referenceNumber: null, quantity: 1 }],
  });

  it("returns no candidates when item identity is missing", async () => {
    const tx = {
      jobItem: { findMany: jest.fn() },
      job: { findMany: jest.fn() },
      jobMessageImportDraft: { findMany: jest.fn() },
    };
    const result = await findDuplicateCandidates({
      tx,
      tenantId: "t1",
      requestedPickupDateYmd: "2026-08-03",
      reviewed: { ...reviewed, items: [] },
    });
    expect(result).toEqual([]);
    expect(tx.jobItem.findMany).not.toHaveBeenCalled();
  });

  it("looks up tenant-scoped jobs by item code and service date", async () => {
    const tx = {
      jobItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            itemCode: "GESU6311344",
            job: {
              id: "job_1",
              internalRef: "WFL-2026-08-0001-IMP",
              jobType: JobType.IMPORT,
              status: "ONGOING",
              pickupDate: new Date("2026-08-03T00:00:00.000Z"),
              customerCompanyId: "c1",
              customerCompany: { name: "Acme" },
              items: [{ itemCode: "GESU6311344" }],
            },
          },
        ]),
      },
      job: { findMany: jest.fn() },
      jobMessageImportDraft: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const result = await findDuplicateCandidates({
      tx,
      tenantId: "t1",
      requestedPickupDateYmd: "2026-08-03",
      reviewed,
      duplicateFingerprint: "fp",
    });
    expect(result).toHaveLength(1);
    expect(result[0].internalRef).toBe("WFL-2026-08-0001-IMP");
    expect(tx.jobItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "t1" }),
      }),
    );
  });

  it("bounds the candidate list", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      itemCode: "GESU6311344",
      job: {
        id: `job_${i}`,
        internalRef: `REF-${i}`,
        jobType: JobType.IMPORT,
        status: "ONGOING",
        pickupDate: new Date("2026-08-03T00:00:00.000Z"),
        customerCompanyId: "c1",
        customerCompany: { name: "Acme" },
        items: [{ itemCode: "GESU6311344" }],
      },
    }));
    const tx = {
      jobItem: { findMany: jest.fn().mockResolvedValue(rows) },
      job: { findMany: jest.fn() },
      jobMessageImportDraft: { findMany: jest.fn() },
    };
    const result = await findDuplicateCandidates({
      tx,
      tenantId: "t1",
      requestedPickupDateYmd: "2026-08-03",
      reviewed,
    });
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("dedupes a confirmed import draft whose job was already returned as a canonical candidate", async () => {
    const tx = {
      jobItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            itemCode: "GESU6311344",
            job: {
              id: "job_1",
              internalRef: "WFL-2026-08-0001-IMP",
              jobType: JobType.IMPORT,
              status: "ONGOING",
              pickupDate: new Date("2026-08-03T00:00:00.000Z"),
              customerCompanyId: "c1",
              customerCompany: { name: "Acme" },
              items: [{ itemCode: "GESU6311344" }],
            },
          },
        ]),
      },
      job: { findMany: jest.fn() },
      jobMessageImportDraft: {
        findMany: jest.fn().mockResolvedValue([{ canonicalJobId: "job_1" }]),
      },
    };
    const result = await findDuplicateCandidates({
      tx,
      tenantId: "t1",
      requestedPickupDateYmd: "2026-08-03",
      reviewed,
      duplicateFingerprint: "fp",
      excludeDraftId: "draft_self",
    });
    expect(result).toHaveLength(1);
    expect(result[0].jobId).toBe("job_1");
    expect(tx.job.findMany).not.toHaveBeenCalled();
  });

  it("does not treat unconfirmed sibling drafts as confirmed-history duplicates", async () => {
    const tx = {
      jobItem: { findMany: jest.fn().mockResolvedValue([]) },
      job: { findMany: jest.fn() },
      jobMessageImportDraft: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await findDuplicateCandidates({
      tx,
      tenantId: "t1",
      requestedPickupDateYmd: "2026-08-03",
      reviewed,
      duplicateFingerprint: "fp",
      excludeDraftId: "draft_self",
    });
    expect(tx.jobMessageImportDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t1",
          confirmedAt: { not: null },
          canonicalJobId: { not: null },
          id: { notIn: ["draft_self"] },
          duplicateFingerprint: { in: ["fp"] },
        }),
      }),
    );
  });

  it("returns candidates in deterministic internalRef/jobId order and caps after dedupe", async () => {
    const rows = [
      {
        itemCode: "GESU6311344",
        job: {
          id: "job_b",
          internalRef: "WFL-B",
          jobType: JobType.IMPORT,
          status: "ONGOING",
          pickupDate: new Date("2026-08-03T00:00:00.000Z"),
          customerCompanyId: "c1",
          customerCompany: { name: "Acme" },
          items: [{ itemCode: "GESU6311344" }],
        },
      },
      {
        itemCode: "GESU6311344",
        job: {
          id: "job_a",
          internalRef: "WFL-A",
          jobType: JobType.IMPORT,
          status: "ONGOING",
          pickupDate: new Date("2026-08-03T00:00:00.000Z"),
          customerCompanyId: "c1",
          customerCompany: { name: "Acme" },
          items: [{ itemCode: "GESU6311344" }],
        },
      },
    ];
    const tx = {
      jobItem: { findMany: jest.fn().mockResolvedValue(rows) },
      job: { findMany: jest.fn() },
      jobMessageImportDraft: { findMany: jest.fn() },
    };
    const result = await findDuplicateCandidates({
      tx,
      tenantId: "t1",
      requestedPickupDateYmd: "2026-08-03",
      reviewed,
    });
    expect(result.map((c) => c.jobId)).toEqual(["job_a", "job_b"]);
  });

  it("matches the Asia/Singapore date-only convention T08:00:00.000Z on the UTC civil day", async () => {
    const tx = {
      jobItem: {
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          const pickup = where.job.pickupDate;
          const jobDate = new Date("2026-08-03T08:00:00.000Z");
          const inWindow = jobDate >= pickup.gte && jobDate <= pickup.lte;
          if (!inWindow) return [];
          return [
            {
              itemCode: "GESU6311344",
              job: {
                id: "job_sg",
                internalRef: "WFL-SG",
                jobType: JobType.IMPORT,
                status: "ONGOING",
                pickupDate: jobDate,
                customerCompanyId: "c1",
                customerCompany: { name: "Acme" },
                items: [{ itemCode: "GESU6311344" }],
              },
            },
          ];
        }),
      },
      job: { findMany: jest.fn() },
      jobMessageImportDraft: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const result = await findDuplicateCandidates({
      tx,
      tenantId: "t1",
      requestedPickupDateYmd: "2026-08-03",
      reviewed,
      duplicateFingerprint: "fp",
    });
    expect(result).toHaveLength(1);
    expect(tx.jobItem.findMany.mock.calls[0][0].where.job.pickupDate).toEqual({
      gte: new Date("2026-08-03T00:00:00.000Z"),
      lte: new Date("2026-08-03T23:59:59.999Z"),
    });
  });

  it("does not match the previous UTC day, even when that instant is Asia/Singapore local midnight of the service date", async () => {
    const tx = {
      jobItem: {
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          const pickup = where.job.pickupDate;
          const sgtMidnight = new Date("2026-08-02T16:00:00.000Z");
          const inWindow = sgtMidnight >= pickup.gte && sgtMidnight <= pickup.lte;
          return inWindow
            ? [
                {
                  itemCode: "GESU6311344",
                  job: {
                    id: "job_prev",
                    internalRef: "WFL-PREV",
                    jobType: JobType.IMPORT,
                    status: "ONGOING",
                    pickupDate: sgtMidnight,
                    customerCompanyId: "c1",
                    customerCompany: { name: "Acme" },
                    items: [{ itemCode: "GESU6311344" }],
                  },
                },
              ]
            : [];
        }),
      },
      job: { findMany: jest.fn() },
      jobMessageImportDraft: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const result = await findDuplicateCandidates({
      tx,
      tenantId: "t1",
      requestedPickupDateYmd: "2026-08-03",
      reviewed,
    });
    expect(result).toEqual([]);
  });
});

describe("findDuplicateCandidatesForDrafts", () => {
  const reviewedA = normalizeReviewedDraft({
    movementType: JobMessageImportMovementType.IMPORT,
    customerCompanyId: "c1",
    pickupAddress1: "Tuas",
    deliveryAddress1: "DB",
    items: [{ containerNumber: "GESU6311344", sealNumber: null, referenceNumber: null, quantity: 1 }],
  });
  const reviewedB = normalizeReviewedDraft({
    movementType: JobMessageImportMovementType.IMPORT,
    customerCompanyId: "c1",
    pickupAddress1: "Tuas",
    deliveryAddress1: "DB",
    items: [{ containerNumber: "ONEY1234567", sealNumber: null, referenceNumber: null, quantity: 1 }],
  });

  it("scans job items once for drafts that share type and service date", async () => {
    const tx = {
      jobItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            itemCode: "GESU6311344",
            job: {
              id: "job_1",
              internalRef: "WFL-A",
              jobType: JobType.IMPORT,
              status: "ONGOING",
              pickupDate: new Date("2026-08-03T00:00:00.000Z"),
              customerCompanyId: "c1",
              customerCompany: { name: "Acme" },
              items: [{ itemCode: "GESU6311344" }],
            },
          },
        ]),
      },
      job: { findMany: jest.fn() },
      jobMessageImportDraft: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const byKey = await findDuplicateCandidatesForDrafts({
      tx,
      tenantId: "t1",
      drafts: [
        {
          key: "d1",
          reviewed: reviewedA,
          requestedPickupDateYmd: "2026-08-03",
          duplicateFingerprint: "fp-a",
        },
        {
          key: "d2",
          reviewed: reviewedB,
          requestedPickupDateYmd: "2026-08-03",
          duplicateFingerprint: "fp-b",
        },
      ],
    });
    expect(tx.jobItem.findMany).toHaveBeenCalledTimes(1);
    expect(tx.jobItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t1",
          itemCode: { in: expect.arrayContaining(["GESU6311344", "ONEY1234567"]) },
        }),
      }),
    );
    expect(byKey.get("d1")).toHaveLength(1);
    expect(byKey.get("d2")).toHaveLength(0);
  });

  it("does not return other-tenant rows even when item codes overlap", async () => {
    const tx = {
      jobItem: { findMany: jest.fn().mockResolvedValue([]) },
      job: { findMany: jest.fn() },
      jobMessageImportDraft: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await findDuplicateCandidatesForDrafts({
      tx,
      tenantId: "tenant-a",
      drafts: [
        {
          key: "d1",
          reviewed: reviewedA,
          requestedPickupDateYmd: "2026-08-03",
        },
      ],
    });
    expect(tx.jobItem.findMany.mock.calls[0][0].where.tenantId).toBe("tenant-a");
    expect(tx.jobItem.findMany.mock.calls[0][0].where.job.tenantId).toBe("tenant-a");
  });
});

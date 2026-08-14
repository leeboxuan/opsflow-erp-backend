import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import {
  JobMessageImportBatchStatus,
  JobMessageImportDraftInclusionState,
  JobMessageImportDraftValidationStatus,
  JobMessageImportMovementType,
  JobStatus,
  JobType,
  Role,
} from "@prisma/client";
import { FakeJobMessageParser } from "./fake-job-message-parser";
import { JobMessageImportService } from "./job-message-import.service";
import { TransportJobsService } from "../transport-jobs.service";
import { JobMessageImportDraftValidationStatus as VS } from "@prisma/client";
import type { JobMessageParser, ParseJobMessageInput, ParseJobMessageResult } from "./job-message-parser";
import { FAKE_JOB_MESSAGE_PARSER_VERSION } from "./job-message-import.constants";
import { reviewedDraftToCreateJobDto } from "./job-message-import.mapping";
import { normalizeReviewedDraft } from "./job-message-import.validator";
import { assertSourceFragmentsTraceable } from "./job-message-import.source-fidelity";

const fixtureMessage = `03/08 JOB
COL
1) 1x20FR pick up ref - ONEYSING45428400
carrier: ocean
shipper: nippon
vessel: ONE HANNOVER / 101W
from - EK 30 pioneer sector 2
to - Chasen whse. 16/18 jln besut
PIC: Shuman 96440435
IMP
1) GESU6311344 / FJ28581743
from - tuas
to - db whse`;

function makePrismaMemory() {
  const batches: any[] = [];
  const drafts: any[] = [];
  const jobs: any[] = [];
  const jobItems: any[] = [];
  const trips: any[] = [];
  const tripJobItems: any[] = [];
  const companies = [{ id: "comp_1", tenantId: "t1", normalizedName: "acme", name: "Acme" }];
  let seq = 0;

  const prisma: any = {
    jobMessageImportBatch: {
      findFirst: jest.fn(async ({ where, include }: any) => {
        const row = batches.find((b) => {
          if (where.id && b.id !== where.id) return false;
          if (where.tenantId && b.tenantId !== where.tenantId) return false;
          if (where.sourceFingerprint && b.sourceFingerprint !== where.sourceFingerprint) return false;
          if (where.status && b.status !== where.status) return false;
          return true;
        });
        if (!row) return null;
        return include?.drafts ? { ...row, drafts: drafts.filter((d) => d.batchId === row.id) } : row;
      }),
      create: jest.fn(async ({ data }: any) => {
        const id = `batch_${++seq}`;
        const batch = {
          id,
          ...data,
          drafts: undefined,
          version: 1,
          createdAt: new Date(),
        };
        batches.push(batch);
        for (const dc of data.drafts?.create ?? []) {
          drafts.push({
            id: `draft_${++seq}`,
            batchId: id,
            version: 1,
            confirmedAt: null,
            canonicalJobId: null,
            duplicateOverrideAt: null,
            duplicateOverrideReason: null,
            duplicateOverrideActorUserId: null,
            ...dc,
          });
        }
        return batch;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = batches.find((b) => b.id === where.id);
        if (!row) return null;
        const next = { ...data };
        if (data.version?.increment) {
          row.version += data.version.increment;
          delete next.version;
        }
        Object.assign(row, next);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = batches.find((b) => {
          if (where.id && b.id !== where.id) return false;
          if (where.tenantId && b.tenantId !== where.tenantId) return false;
          if (where.status && b.status !== where.status) return false;
          if (where.version != null && b.version !== where.version) return false;
          return true;
        });
        if (!row) return { count: 0 };
        if (data.version?.increment) row.version += data.version.increment;
        Object.assign(row, { ...data, version: row.version });
        return { count: 1 };
      }),
    },
    jobMessageImportDraft: {
      findFirst: jest.fn(async ({ where }: any) =>
        drafts.find((d) => {
          if (where.id && d.id !== where.id) return false;
          if (where.tenantId && d.tenantId !== where.tenantId) return false;
          if (where.batchId && d.batchId !== where.batchId) return false;
          return true;
        }) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        drafts.filter((d) => {
          if (where.tenantId && d.tenantId !== where.tenantId) return false;
          if (where.batchId && d.batchId !== where.batchId) return false;
          if (where.duplicateFingerprint && d.duplicateFingerprint !== where.duplicateFingerprint) {
            return false;
          }
          if (where.confirmedAt?.not === null && !d.confirmedAt) return false;
          if (where.canonicalJobId?.not === null && !d.canonicalJobId) return false;
          if (where.id?.not && d.id === where.id.not) return false;
          return true;
        }),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = drafts.find((d) => d.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = drafts.find((d) => {
          if (where.id && d.id !== where.id) return false;
          if (where.tenantId && d.tenantId !== where.tenantId) return false;
          if (where.version != null && d.version !== where.version) return false;
          if (where.confirmedAt === null && d.confirmedAt) return false;
          return true;
        });
        if (!row) return { count: 0 };
        if (data.version?.increment) row.version += data.version.increment;
        Object.assign(row, { ...data, version: row.version });
        return { count: 1 };
      }),
    },
    customer_companies: {
      findFirst: jest.fn(async ({ where }: any) =>
        companies.find((c) => {
          if (where.tenantId && c.tenantId !== where.tenantId) return false;
          if (where.id && c.id !== where.id) return false;
          if (where.normalizedName && c.normalizedName !== where.normalizedName) return false;
          return true;
        }) ?? null,
      ),
    },
    jobItem: {
      findMany: jest.fn(async ({ where }: any = {}) =>
        jobItems.filter((it) => {
          if (where?.tenantId && it.tenantId !== where.tenantId) return false;
          if (where?.itemCode?.in && !where.itemCode.in.includes(it.itemCode)) return false;
          if (where?.id?.in && !where.id.in.includes(it.id)) return false;
          if (where?.jobId && it.jobId !== where.jobId) return false;
          return true;
        }),
      ),
    },
    job: {
      findMany: jest.fn(async ({ where }: any = {}) =>
        jobs.filter((j) => {
          if (where?.tenantId && j.tenantId !== where.tenantId) return false;
          if (where?.id?.in && !where.id.in.includes(j.id)) return false;
          return true;
        }),
      ),
      findFirst: jest.fn(async ({ where }: any = {}) => {
        const job = jobs.find((j) => {
          if (where?.id && j.id !== where.id) return false;
          if (where?.tenantId && j.tenantId !== where.tenantId) return false;
          return true;
        });
        if (!job) return null;
        return {
          ...job,
          items: jobItems.filter((it) => it.jobId === job.id),
          trips: trips
            .filter((t) => t.jobId === job.id)
            .map((t) => ({
              ...t,
              payoutLines: [],
              _count: { tripJobItems: tripJobItems.filter((l) => l.tripId === t.id).length },
            })),
          charges: [],
          documents: [],
          assignedDriver: null,
          createdBy: null,
          customerCompany: companies.find((c) => c.id === job.customerCompanyId) ?? null,
          sourceCustomerQuotation: null,
        };
      }),
      create: jest.fn(async ({ data }: any) => {
        const id = `job_${++seq}`;
        const { items: itemsNested, ...jobFields } = data;
        const items = (itemsNested?.create ?? []).map((it: any) => ({
          id: `item_${++seq}`,
          createdAt: new Date(),
          ...it,
          tenantId: data.tenantId,
          jobId: id,
        }));
        const job = {
          id,
          ...jobFields,
          items,
          customerCompany: companies.find((c) => c.id === data.customerCompanyId) ?? null,
          assignedDriver: null,
          createdBy: null,
          trips: [],
          charges: [],
          documents: [],
        };
        jobs.push(job);
        for (const it of items) {
          jobItems.push({ ...it, job });
        }
        return job;
      }),
    },
    trip: {
      create: jest.fn(),
      createMany: jest.fn(async ({ data }: any) => {
        const rows = Array.isArray(data) ? data : [];
        for (const row of rows) {
          trips.push({
            id: `trip_${++seq}`,
            status: row.status ?? "DRAFT",
            ...row,
          });
        }
        return { count: rows.length };
      }),
      findMany: jest.fn(async ({ where }: any = {}) =>
        trips.filter((t) => {
          if (where?.tenantId && t.tenantId !== where.tenantId) return false;
          if (where?.jobId && t.jobId !== where.jobId) return false;
          return true;
        }),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = trips.find((t) => t.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
    tripJobItem: {
      findMany: jest.fn(async ({ where, include }: any = {}) =>
        tripJobItems
          .filter((l) => {
            if (where?.tenantId && l.tenantId !== where.tenantId) return false;
            if (where?.tripId && l.tripId !== where.tripId) return false;
            return true;
          })
          .map((l) => {
            if (!include?.jobItem) return l;
            const it = jobItems.find((j) => j.id === l.jobItemId);
            return {
              ...l,
              jobItem: it
                ? {
                    id: it.id,
                    itemCode: it.itemCode,
                    description: it.description ?? null,
                    sealNo: it.sealNo ?? null,
                    pickupReference: it.pickupReference ?? null,
                    qty: it.qty ?? null,
                  }
                : null,
            };
          }),
      ),
      createMany: jest.fn(async ({ data }: any) => {
        const rows = Array.isArray(data) ? data : [];
        for (const row of rows) {
          tripJobItems.push({ id: `tji_${++seq}`, ...row });
        }
        return { count: rows.length };
      }),
    },
    tripDocumentRequirement: {
      findMany: jest.fn(async () => []),
      createMany: jest.fn(async () => ({ count: 0 })),
    },
    masterLogisticsLocation: {
      findFirst: jest.fn(async () => null),
    },
    job_internal_ref_counters: {
      upsert: jest.fn(async () => ({ nextSeq: jobs.length + 1 })),
    },
    $transaction: jest.fn(async (cb: any) => {
      const clone = (rows: any[]) => rows.map((r) => ({ ...r }));
      const snap = {
        batches: clone(batches),
        drafts: clone(drafts),
        jobs: clone(jobs),
        jobItems: clone(jobItems),
        trips: clone(trips),
        tripJobItems: clone(tripJobItems),
      };
      try {
        return await cb(prisma);
      } catch (e) {
        batches.splice(0, batches.length, ...snap.batches);
        drafts.splice(0, drafts.length, ...snap.drafts);
        jobs.splice(0, jobs.length, ...snap.jobs);
        jobItems.splice(0, jobItems.length, ...snap.jobItems);
        trips.splice(0, trips.length, ...snap.trips);
        tripJobItems.splice(0, tripJobItems.length, ...snap.tripJobItems);
        throw e;
      }
    }),
    _state: { batches, drafts, jobs, jobItems, trips, tripJobItems },
  };
  return prisma;
}

function makeJobsService(prisma: any) {
  const jobs = new TransportJobsService(
    prisma,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    { getClient: jest.fn() } as any,
  );
  jest.spyOn(jobs as any, "generateTripDeliveryDoDocument").mockResolvedValue({});
  jest.spyOn(jobs as any, "attachTripAssignedDriverNamesForJobs").mockResolvedValue(undefined);
  jest.spyOn(jobs as any, "syncJobInvoiceReadinessForJob").mockResolvedValue(undefined);
  jest.spyOn(jobs as any, "syncTripRouteSnapshotForJob").mockResolvedValue(undefined);
  return jobs;
}

function makeImportSvc(
  prisma: any,
  audit: any,
  parser: JobMessageParser = new FakeJobMessageParser(),
) {
  return new JobMessageImportService(prisma, audit, parser as any, makeJobsService(prisma));
}

function confirmDraftsFromPreview(
  preview: {
    drafts: Array<{
      id: string;
      reviewed: any;
      duplicateOverride?: { acknowledged: boolean; reason: string | null };
    }>;
  },
  opts?: {
    ids?: string[];
    extra?: Record<string, Record<string, unknown>>;
    customerCompanyId?: string | null;
  },
) {
  const allow = opts?.ids ? new Set(opts.ids) : null;
  return preview.drafts
    .filter((d) => (allow ? allow.has(d.id) : true))
    .map((d) => ({
      draftId: d.id,
      ...d.reviewed,
      customerCompanyId:
        opts?.customerCompanyId !== undefined
          ? opts.customerCompanyId
          : (d.reviewed.customerCompanyId ?? "comp_1"),
      collectionType:
        d.reviewed.movementType === "COLLECTION"
          ? d.reviewed.collectionType ?? "EMPTY"
          : d.reviewed.collectionType,
      pickupDateNeedsReview: false,
      deliveryDateNeedsReview: false,
      duplicateOverrideAcknowledged: d.duplicateOverride?.acknowledged,
      duplicateOverrideReason: d.duplicateOverride?.reason,
      ...(opts?.extra?.[d.id] ?? {}),
    }));
}

describe("JobMessageImportService workflow", () => {
  const audit = { log: jest.fn().mockResolvedValue(undefined) };

  it("preview persists parsedJson and controllerJson without canonical writes", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    const res = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    expect(res.drafts.length).toBeGreaterThan(0);
    expect(prisma._state.jobs).toHaveLength(0);
    expect(prisma._state.drafts[0].parsedJson.sourceFragment).toBeTruthy();
    expect(prisma._state.drafts[0].controllerJson.pickupAddress1).toBeTruthy();
    expect(res.summary.needsReview).toBeGreaterThan(0);
  });

  it("reuses an in-review batch for the same source fingerprint instead of creating twins", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    const a = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    const b = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    expect(a.batchId).toBe(b.batchId);
    expect(prisma._state.batches).toHaveLength(1);
  });

  it("GET resumes stored review without reparsing", async () => {
    const prisma = makePrismaMemory();
    const parser = new FakeJobMessageParser();
    const parseSpy = jest.spyOn(parser, "parse");
    const svc = makeImportSvc(prisma, audit, parser);
    const preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    expect(parseSpy).toHaveBeenCalledTimes(1);
    const resumed = await svc.getBatchPreview({ tenantId: "t1", batchId: preview.batchId });
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(resumed.batchId).toBe(preview.batchId);
    expect(resumed.drafts[0].reviewed.pickupAddress1).toBeTruthy();
    expect(resumed.drafts[0].parsed.pickupRawText).toBeTruthy();
    expect(resumed.confirmable).toBe(false);
  });

  it("rejects oversized input before calling the parser", async () => {
    const prisma = makePrismaMemory();
    const parser = { getParserVersion: () => "v", parse: jest.fn(), getModelName: () => null };
    const svc = makeImportSvc(prisma, audit, parser);
    await expect(
      svc.createPreviewBatch({
        tenantId: "t1",
        actorUserId: "u1",
        timezone: "Asia/Singapore",
        sourceChannel: "WHATSAPP" as any,
        sourceText: "x".repeat(25_000),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it("rejects malformed provider output", async () => {
    const prisma = makePrismaMemory();
    const parser = {
      getParserVersion: () => "v",
      getModelName: () => null,
      parse: jest.fn().mockResolvedValue({ message: { parserVersion: 1, drafts: "nope" }, meta: { modelName: null, usage: null, providerRequestId: null } }),
    };
    const svc = makeImportSvc(prisma, audit, parser);
    await expect(
      svc.createPreviewBatch({
        tenantId: "t1",
        actorUserId: "u1",
        timezone: "Asia/Singapore",
        sourceChannel: "WHATSAPP" as any,
        sourceText: "anything",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("denies cross-tenant batch access", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    const res = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    await expect(svc.getBatchPreview({ tenantId: "other", batchId: res.batchId })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("PATCH updates controllerJson, preserves parsedJson, and bumps version", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    const preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    const draft = preview.drafts[0];
    const originalParsed = JSON.stringify(prisma._state.drafts[0].parsedJson);
    const updated = await svc.patchDraft({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      draftId: draft.id,
      patch: {
        expectedDraftVersion: draft.draftVersion,
        customerCompanyId: "comp_1",
        collectionType: draft.reviewed.movementType === "COLLECTION" ? "EMPTY" : null,
      },
    });
    const next = updated.drafts.find((d) => d.id === draft.id)!;
    expect(next.reviewed.customerCompanyId).toBe("comp_1");
    expect(next.draftVersion).toBe(draft.draftVersion + 1);
    expect(JSON.stringify(prisma._state.drafts.find((d: any) => d.id === draft.id).parsedJson)).toBe(
      originalParsed,
    );
  });

  it("PATCH rejects stale versions", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    const preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    const draft = preview.drafts[0];
    await expect(
      svc.patchDraft({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        draftId: draft.id,
        patch: { expectedDraftVersion: draft.draftVersion + 9, pickupAddress1: "x" },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("confirm creates jobs from controllerJson, skips excluded drafts, and is idempotent", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    let preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });

    for (const d of preview.drafts) {
      preview = await svc.patchDraft({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        draftId: d.id,
        patch: {
          expectedDraftVersion: preview.drafts.find((x) => x.id === d.id)!.draftVersion,
          customerCompanyId: "comp_1",
          collectionType: d.reviewed.movementType === "COLLECTION" ? "EMPTY" : undefined,
          inclusionState:
            d.reviewed.movementType === JobMessageImportMovementType.IMPORT
              ? JobMessageImportDraftInclusionState.INCLUDED
              : JobMessageImportDraftInclusionState.EXCLUDED,
        },
      });
    }

    const included = preview.drafts.filter((d) => d.inclusionState === "INCLUDED");
    expect(included.length).toBeGreaterThan(0);
    expect(included.every((d) => d.validationStatus === VS.READY || d.reviewed.customerCompanyId)).toBe(
      true,
    );

    const first = await svc.confirmBatch({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      drafts: confirmDraftsFromPreview(preview, { ids: included.map((d) => d.id) }),
    });
    expect(first.createdCount).toBe(included.length);
    expect(prisma._state.jobs).toHaveLength(included.length);
    expect(prisma._state.jobs[0].pickupAddress1).toBeTruthy();
    expect(prisma._state.drafts.filter((d: any) => d.canonicalJobId).length).toBe(included.length);

    const again = await svc.confirmBatch({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      drafts: confirmDraftsFromPreview(preview, { ids: included.map((d) => d.id) }),
    });
    expect(again.createdJobIds).toEqual(first.createdJobIds);
    expect(prisma._state.jobs).toHaveLength(included.length);
  });

  it("blocks confirmation when an included draft is invalid", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    const preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    await expect(
      svc.confirmBatch({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        drafts: confirmDraftsFromPreview(preview, { customerCompanyId: null }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma._state.jobs).toHaveLength(0);
  });

  it("requires duplicate override before confirming a possible duplicate", async () => {
    const prisma = makePrismaMemory();
    prisma.jobItem.findMany.mockResolvedValue([
      {
        itemCode: "GESU6311344",
        job: {
          id: "existing_job",
          internalRef: "WFL-OLD",
          jobType: "IMPORT",
          status: "ONGOING",
          pickupDate: new Date("2026-08-03T00:00:00.000Z"),
          customerCompanyId: "comp_1",
          customerCompany: { name: "Acme" },
          items: [{ itemCode: "GESU6311344" }],
        },
      },
    ]);
    const svc = makeImportSvc(prisma, audit);
    let preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    const imp = preview.drafts.find((d) => d.reviewed.items.some((it) => it.containerNumber === "GESU6311344"));
    expect(imp).toBeTruthy();
    preview = await svc.patchDraft({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      draftId: imp!.id,
      patch: {
        expectedDraftVersion: imp!.draftVersion,
        customerCompanyId: "comp_1",
      },
    });
    const after = preview.drafts.find((d) => d.id === imp!.id)!;
    expect(after.validationStatus).toBe(JobMessageImportDraftValidationStatus.POSSIBLE_DUPLICATE);
    expect(after.duplicateCandidates.length).toBeGreaterThan(0);

    for (const d of preview.drafts) {
      if (d.id === after.id) continue;
      preview = await svc.patchDraft({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        draftId: d.id,
        patch: {
          expectedDraftVersion: preview.drafts.find((x) => x.id === d.id)!.draftVersion,
          inclusionState: JobMessageImportDraftInclusionState.EXCLUDED,
        },
      });
    }
    const latest = preview.drafts.find((d) => d.id === after.id)!;
    await expect(
      svc.confirmBatch({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        drafts: confirmDraftsFromPreview(preview, { ids: [latest.id] }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    preview = await svc.patchDraft({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      draftId: latest.id,
      patch: {
        expectedDraftVersion: preview.drafts.find((d) => d.id === latest.id)!.draftVersion,
        duplicateOverrideAcknowledged: true,
        duplicateOverrideReason: "Different consignee",
      },
    });
    const ready = preview.drafts.find((d) => d.id === latest.id)!;
    expect(ready.validationStatus).toBe(JobMessageImportDraftValidationStatus.READY);
    const confirmed = await svc.confirmBatch({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      drafts: confirmDraftsFromPreview(preview, {
        ids: [ready.id],
        extra: { [ready.id]: { duplicateOverrideAcknowledged: true, duplicateOverrideReason: "Different consignee" } },
      }),
    });
    expect(confirmed.createdCount).toBe(1);
  });

  it("creates canonical jobs from controllerJson rather than stale parsedJson", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    let preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    const imp = preview.drafts.find((d) => d.reviewed.movementType === "IMPORT")!;
    expect(imp.parsed.pickupRawText).not.toBe("CONTROLLER PICKUP");
    const confirmed = await svc.confirmBatch({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      drafts: confirmDraftsFromPreview(preview, {
        ids: [imp.id],
        extra: { [imp.id]: { pickupAddress1: "CONTROLLER PICKUP" } },
      }),
    });
    expect(confirmed.createdCount).toBe(1);
    expect(prisma._state.jobs[0].pickupAddress1).toBe("CONTROLLER PICKUP");
    expect(prisma.trip.createMany).toHaveBeenCalled();
    expect(prisma._state.trips.length).toBeGreaterThan(0);
  });

  it("rejects foreign draft IDs and keeps confirmed batches immutable", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    let preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    await expect(
      svc.confirmBatch({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        drafts: [{ draftId: "foreign_draft", customerCompanyId: "comp_1", pickupAddress1: "X", deliveryAddress1: "Y", movementType: "IMPORT", items: [{ containerNumber: "GESU6311344", sealNumber: null, referenceNumber: null, quantity: 1 }] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    for (const d of preview.drafts) {
      preview = await svc.patchDraft({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        draftId: d.id,
        patch: {
          expectedDraftVersion: preview.drafts.find((x) => x.id === d.id)!.draftVersion,
          customerCompanyId: "comp_1",
          collectionType: d.reviewed.movementType === "COLLECTION" ? "EMPTY" : undefined,
          inclusionState:
            d.reviewed.movementType === JobMessageImportMovementType.IMPORT
              ? JobMessageImportDraftInclusionState.INCLUDED
              : JobMessageImportDraftInclusionState.EXCLUDED,
        },
      });
    }
    const included = preview.drafts.filter((d) => d.inclusionState === "INCLUDED");
    await svc.confirmBatch({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      drafts: confirmDraftsFromPreview(preview, { ids: included.map((d) => d.id) }),
    });
    await expect(
      svc.patchDraft({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        draftId: included[0].id,
        patch: { expectedDraftVersion: included[0].draftVersion, pickupAddress1: "nope" },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("allows a new preview of the same source after the prior batch is confirmed", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    let preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    for (const d of preview.drafts) {
      preview = await svc.patchDraft({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        draftId: d.id,
        patch: {
          expectedDraftVersion: preview.drafts.find((x) => x.id === d.id)!.draftVersion,
          customerCompanyId: "comp_1",
          collectionType: d.reviewed.movementType === "COLLECTION" ? "EMPTY" : undefined,
          inclusionState:
            d.reviewed.movementType === JobMessageImportMovementType.IMPORT
              ? JobMessageImportDraftInclusionState.INCLUDED
              : JobMessageImportDraftInclusionState.EXCLUDED,
        },
      });
    }
    const included = preview.drafts.filter((d) => d.inclusionState === "INCLUDED");
    await svc.confirmBatch({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      drafts: confirmDraftsFromPreview(preview, { ids: included.map((d) => d.id) }),
    });
    const second = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    expect(second.batchId).not.toBe(preview.batchId);
    expect(prisma._state.batches).toHaveLength(2);
    expect(second.status).toBe(JobMessageImportBatchStatus.IN_REVIEW);
  });

  it("rolls back the confirm claim when Job creation fails inside the transaction", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    let preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    const versionBefore = preview.version;
    for (const d of preview.drafts) {
      preview = await svc.patchDraft({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        draftId: d.id,
        patch: {
          expectedDraftVersion: preview.drafts.find((x) => x.id === d.id)!.draftVersion,
          customerCompanyId: "comp_1",
          collectionType: d.reviewed.movementType === "COLLECTION" ? "EMPTY" : undefined,
          inclusionState:
            d.reviewed.movementType === JobMessageImportMovementType.IMPORT
              ? JobMessageImportDraftInclusionState.INCLUDED
              : JobMessageImportDraftInclusionState.EXCLUDED,
        },
      });
    }
    prisma.job.create.mockRejectedValueOnce(new Error("forced job create failure"));
    const included = preview.drafts.filter((d) => d.inclusionState === "INCLUDED");
    audit.log.mockClear();
    await expect(
      svc.confirmBatch({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        drafts: confirmDraftsFromPreview(preview, { ids: included.map((d) => d.id) }),
      }),
    ).rejects.toThrow("forced job create failure");
    expect(prisma._state.jobs).toHaveLength(0);
    expect(prisma._state.batches[0].status).toBe(JobMessageImportBatchStatus.IN_REVIEW);
    expect(prisma._state.batches[0].version).toBe(preview.version);
    expect(prisma._state.drafts.every((d: any) => !d.canonicalJobId)).toBe(true);
    expect(prisma._state.batches[0].version).toBeGreaterThanOrEqual(versionBefore);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("reuses the winning IN_REVIEW batch when preview create hits a unique conflict", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    const first = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    const origCreate = prisma.jobMessageImportBatch.create;
    let finds = 0;
    const origFind = prisma.jobMessageImportBatch.findFirst;
    prisma.jobMessageImportBatch.findFirst = jest.fn(async (args: any) => {
      finds += 1;
      if (finds === 1) return null;
      return origFind(args);
    });
    prisma.jobMessageImportBatch.create = jest.fn(async () => {
      const err: any = new Error("unique");
      err.code = "P2002";
      throw err;
    });
    const reused = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    expect(reused.batchId).toBe(first.batchId);
    expect(prisma._state.batches).toHaveLength(1);
    prisma.jobMessageImportBatch.create = origCreate;
  });

  it("PATCH applies controller edits only when the expected draft version still matches", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    const preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    const draft = preview.drafts[0];
    await svc.patchDraft({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      draftId: draft.id,
      patch: { expectedDraftVersion: draft.draftVersion, pickupAddress1: "A" },
    });
    const write = prisma.jobMessageImportDraft.updateMany.mock.calls.at(-1)[0];
    expect(write.where).toEqual(
      expect.objectContaining({
        id: draft.id,
        tenantId: "t1",
        version: draft.draftVersion,
        confirmedAt: null,
      }),
    );
    await expect(
      svc.patchDraft({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        draftId: draft.id,
        patch: { expectedDraftVersion: draft.draftVersion, pickupAddress1: "B" },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("does not let excluded invalid drafts block confirmable included drafts", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    let preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    const imp = preview.drafts.find((d) => d.reviewed.movementType === "IMPORT")!;
    for (const d of preview.drafts) {
      preview = await svc.patchDraft({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        draftId: d.id,
        patch: {
          expectedDraftVersion: preview.drafts.find((x) => x.id === d.id)!.draftVersion,
          customerCompanyId: d.id === imp.id ? "comp_1" : undefined,
          inclusionState:
            d.id === imp.id
              ? JobMessageImportDraftInclusionState.INCLUDED
              : JobMessageImportDraftInclusionState.EXCLUDED,
        },
      });
    }
    expect(preview.confirmable).toBe(true);
    expect(preview.drafts.some((d) => d.inclusionState === "EXCLUDED" && d.validationStatus !== "READY")).toBe(
      true,
    );
  });

  it("creates equivalent IMPORT canonical state via manual create and AI import confirm", async () => {
    const reviewed = normalizeReviewedDraft({
      movementType: JobMessageImportMovementType.IMPORT,
      customerCompanyId: "comp_1",
      pickupAddress1: "Tuas",
      deliveryAddress1: "DB warehouse",
      picName: "Shuman",
      picPhone: "96440435",
      carrierName: "ocean",
      shipper: "nippon",
      vesselName: "ONE HANNOVER",
      voyage: "101W",
      items: [
        {
          containerNumber: "GESU6311344",
          sealNumber: "FJ28581743",
          referenceNumber: null,
          quantity: 1,
        },
      ],
    });
    const createDto = reviewedDraftToCreateJobDto({
      reviewed,
      timezone: "Asia/Singapore",
    });

    const prismaManual = makePrismaMemory();
    const manualJobs = makeJobsService(prismaManual);
    await manualJobs.create("t1", createDto, {
      userId: "u1",
      role: Role.TRANSPORT_STAFF,
    });

    const prismaImport = makePrismaMemory();
    const importSvc = makeImportSvc(prismaImport, audit);
    const preview = await importSvc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    const imp = preview.drafts.find((d) => d.reviewed.movementType === "IMPORT")!;
    await importSvc.confirmBatch({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      drafts: confirmDraftsFromPreview(preview, {
        ids: [imp.id],
        extra: {
          [imp.id]: {
            pickupAddress1: reviewed.pickupAddress1,
            deliveryAddress1: reviewed.deliveryAddress1,
            picName: reviewed.picName,
            picPhone: reviewed.picPhone,
            carrierName: reviewed.carrierName,
            shipper: reviewed.shipper,
            vesselName: reviewed.vesselName,
            voyage: reviewed.voyage,
            items: reviewed.items,
          },
        },
      }),
    });

    const jobA = prismaManual._state.jobs[0];
    const jobB = prismaImport._state.jobs[0];
    expect(jobA.status).toBe(JobStatus.ONGOING);
    expect(jobB.status).toBe(jobA.status);
    expect(jobB.jobType).toBe(JobType.IMPORT);
    expect(jobB.jobType).toBe(jobA.jobType);
    expect(jobB.customerCompanyId).toBe(jobA.customerCompanyId);
    expect(jobB.pickupAddress1).toBe(jobA.pickupAddress1);
    expect(jobB.deliveryAddress1).toBe(jobA.deliveryAddress1);
    expect(jobB.pickupContactName).toBe(jobA.pickupContactName);
    expect(jobB.receiverName).toBe(jobA.receiverName);
    expect(jobB.carrierName).toBe(jobA.carrierName);
    expect(jobB.shipper).toBe(jobA.shipper);
    expect(jobB.vesselName).toBe(jobA.vesselName);
    expect(jobB.voyage).toBe(jobA.voyage);
    expect(jobB.collectionType).toBe(jobA.collectionType);
    expect(jobB.items.map((it: any) => ({ itemCode: it.itemCode, sealNo: it.sealNo, qty: it.qty }))).toEqual(
      jobA.items.map((it: any) => ({ itemCode: it.itemCode, sealNo: it.sealNo, qty: it.qty })),
    );
    expect(prismaImport._state.trips.map((t: any) => t.jobTripTemplate).sort()).toEqual(
      prismaManual._state.trips.map((t: any) => t.jobTripTemplate).sort(),
    );
    expect(prismaImport._state.trips).toHaveLength(prismaManual._state.trips.length);
    // IDs, timestamps, and allocated internal refs may differ. Import also writes
    // batch/draft provenance plus AI_JOB_MESSAGE_IMPORT_CONFIRM audit after the shared CREATE audit.
    expect(jobA.id).not.toBeUndefined();
    expect(jobB.id).not.toBeUndefined();
    expect(prismaImport._state.drafts.some((d: any) => d.canonicalJobId === jobB.id)).toBe(true);
  });
});

const threeJobMessage = [
  "UNIQUE-THREE-JOB-MESSAGE-9c2d",
  "COL empty collection for Ocean Network Express",
  "from - 10 Pioneer Sector 2",
  "to - PSA Terminal",
  "COL loaded collection for Maersk Singapore",
  "from - Tuas Avenue 9",
  "to - DB Schenker warehouse",
  "DEL delivery for Pacific Logistics",
  "from - Jurong Port",
  "to - 1 North Coast Drive",
].join("\n");

class StubJobMessageParser implements JobMessageParser {
  constructor(private readonly result: ParseJobMessageResult) {}

  getParserVersion(): string {
    return this.result.message.parserVersion;
  }

  getModelName(): string | null {
    return this.result.meta.modelName;
  }

  async parse(_input: ParseJobMessageInput): Promise<ParseJobMessageResult> {
    return this.result;
  }
}

describe("JobMessageImportService parser safeguards", () => {
  const audit = { log: jest.fn().mockResolvedValue(undefined) };

  it("rejects parser output whose sourceFragment is absent from the submitted text", async () => {
    const prisma = makePrismaMemory();
    const parser = new StubJobMessageParser({
      message: {
        parserVersion: "opsflow.job_message_parser.v1",
        batchWarnings: [],
        drafts: [
          {
            clientDraftId: "d1",
            movementType: "IMPORT",
            customerNameText: null,
            earliestAt: null,
            latestAt: null,
            timingText: null,
            pickup: { rawText: "tuas" },
            delivery: { rawText: "db whse" },
            carrier: null,
            shipper: null,
            vessel: null,
            voyage: null,
            containerSizeType: null,
            items: [],
            picName: null,
            picPhone: null,
            instructions: [],
            notes: null,
            sourceFragment: "GESU6311344 / FJ28581743",
            fieldEvidence: [],
            warnings: [],
          },
        ],
      },
      meta: { modelName: "gpt-4.1-mini", usage: null, providerRequestId: "req_1" },
    });
    const svc = makeImportSvc(prisma, audit, parser);

    await expect(
      svc.createPreviewBatch({
        tenantId: "t1",
        actorUserId: "u1",
        timezone: "Asia/Singapore",
        sourceChannel: "WHATSAPP" as any,
        sourceText: threeJobMessage,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts three traceable drafts for a three-job message", async () => {
    const prisma = makePrismaMemory();
    const parser = new StubJobMessageParser({
      message: {
        parserVersion: "opsflow.job_message_parser.v1",
        batchWarnings: [],
        drafts: [
          {
            clientDraftId: "col-empty",
            movementType: "COLLECTION",
            customerNameText: "Ocean Network Express",
            earliestAt: null,
            latestAt: null,
            timingText: null,
            pickup: { rawText: "10 Pioneer Sector 2" },
            delivery: { rawText: "PSA Terminal" },
            carrier: null,
            shipper: null,
            vessel: null,
            voyage: null,
            containerSizeType: null,
            items: [],
            picName: null,
            picPhone: null,
            instructions: [],
            notes: null,
            sourceFragment: "COL empty collection for Ocean Network Express",
            fieldEvidence: [],
            warnings: [],
          },
          {
            clientDraftId: "col-loaded",
            movementType: "COLLECTION",
            customerNameText: "Maersk Singapore",
            earliestAt: null,
            latestAt: null,
            timingText: null,
            pickup: { rawText: "Tuas Avenue 9" },
            delivery: { rawText: "DB Schenker warehouse" },
            carrier: null,
            shipper: null,
            vessel: null,
            voyage: null,
            containerSizeType: null,
            items: [],
            picName: null,
            picPhone: null,
            instructions: [],
            notes: null,
            sourceFragment: "COL loaded collection for Maersk Singapore",
            fieldEvidence: [],
            warnings: [],
          },
          {
            clientDraftId: "del-1",
            movementType: "IMPORT",
            customerNameText: "Pacific Logistics",
            earliestAt: null,
            latestAt: null,
            timingText: null,
            pickup: { rawText: "Jurong Port" },
            delivery: { rawText: "1 North Coast Drive" },
            carrier: null,
            shipper: null,
            vessel: null,
            voyage: null,
            containerSizeType: null,
            items: [],
            picName: null,
            picPhone: null,
            instructions: [],
            notes: null,
            sourceFragment: "DEL delivery for Pacific Logistics",
            fieldEvidence: [],
            warnings: [],
          },
        ],
      },
      meta: { modelName: "gpt-4.1-mini", usage: null, providerRequestId: "req_2" },
    });
    const svc = makeImportSvc(prisma, audit, parser);
    const res = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: threeJobMessage,
    });

    expect(res.drafts).toHaveLength(3);
    expect(res.parserVersion).toBe("opsflow.job_message_parser.v1");
    expect(res.modelName).toBe("gpt-4.1-mini");
    expect(res.drafts.map((d) => d.sourceFragment)).toEqual([
      "COL empty collection for Ocean Network Express",
      "COL loaded collection for Maersk Singapore",
      "DEL delivery for Pacific Logistics",
    ]);
  });

  it("rejects fake fixture parser output in production", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const prisma = makePrismaMemory();
      const parser = new StubJobMessageParser({
        message: {
          parserVersion: FAKE_JOB_MESSAGE_PARSER_VERSION,
          batchWarnings: [],
          drafts: [
            {
              clientDraftId: "d1",
              movementType: "IMPORT",
              customerNameText: null,
              earliestAt: null,
              latestAt: null,
              timingText: null,
              pickup: { rawText: null },
              delivery: { rawText: null },
              carrier: null,
              shipper: null,
              vessel: null,
              voyage: null,
              containerSizeType: null,
              items: [],
              picName: null,
              picPhone: null,
              instructions: [],
              notes: null,
              sourceFragment: "UNIQUE-THREE-JOB-MESSAGE-9c2d",
              fieldEvidence: [],
              warnings: [],
            },
          ],
        },
        meta: { modelName: null, usage: null, providerRequestId: null },
      });
      const svc = makeImportSvc(prisma, audit, parser);

      await expect(
        svc.createPreviewBatch({
          tenantId: "t1",
          actorUserId: "u1",
          timezone: "Asia/Singapore",
          sourceChannel: "WHATSAPP" as any,
          sourceText: threeJobMessage,
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});

const productionWhatsAppThreeJobMessage = [
  "UNIQUE-PRODUCTION-WA-THREE-JOB-b4e1",
  "Hi team, please arrange these jobs:",
  "",
  "1. EMPTY COLLECTION",
  "Customer: Ocean Network Express",
  "Pickup: PSA, 15/08 @ 2300",
  "Delivery: Chasen Warehouse, 16 Jalan Buroh, Singapore 128578, #01-01",
  "Requested delivery: 16/08 @ 0100",
  "Container: ONEY1234567",
  "Seal:",
  "Carrier: Ocean Network Express",
  "Shipper: Nippon",
  "Vessel: ONE HANNOVER",
  "Voyage: 101W",
  "PIC: Shuman, 9644 0435",
  "Instruction: Call PIC 30 minutes before arrival.",
  "",
  "2. LOADED COLLECTION",
  "Customer: Maersk Singapore",
  "Pickup: Pasir Panjang Terminal, 16/08 @ 0900",
  "Delivery: 21 Tuas Avenue 3, Singapore 639417, #03-02",
  "Requested delivery: 16/08 before 1200",
  "Container: MSKU7654321",
  "Seal: SG889921",
  "Carrier: Maersk",
  "Shipper: Pacific Manufacturing",
  "PIC: Daniel, 9123 4567",
  "Instruction: Driver must bring safety vest and helmet.",
  "",
  "3. DELIVERY – GENERAL CARGO",
  "Customer: Pacific Logistics",
  "Pickup: 30 Pioneer Road North, Singapore 628471, #02-05",
  "Requested pickup: 16/08 between 1400-1500",
  "Delivery: Jurong Port, 37 Jurong Port Road, Singapore 619110",
  "Requested delivery: 16/08 @ 1700",
  "Items:",
  "PLT-001 | SEAL7788 | 4",
  "PLT-002 | SEAL7790 | 2",
  "PIC: Mei Ling, 9876 5432",
  "Instruction: Obtain POD and send it to the operations group.",
  "",
  "Please confirm once all three jobs are created.",
].join("\n");

function contiguousJobFragment(startNeedle: string, endNeedle: string): string {
  const start = productionWhatsAppThreeJobMessage.indexOf(startNeedle);
  const end = productionWhatsAppThreeJobMessage.indexOf(endNeedle, start + startNeedle.length);
  if (start < 0 || end < 0) {
    throw new Error(`Could not slice fragment between ${startNeedle} and ${endNeedle}`);
  }
  return productionWhatsAppThreeJobMessage.slice(start, end).trim();
}

const job1SourceFragment = contiguousJobFragment(
  "1. EMPTY COLLECTION",
  "2. LOADED COLLECTION",
);
const job2SourceFragment = contiguousJobFragment(
  "2. LOADED COLLECTION",
  "3. DELIVERY",
);
const job3SourceFragment = contiguousJobFragment(
  "Customer: Pacific Logistics",
  "Please confirm once all three jobs are created.",
);

function productionWhatsAppParserResult(): ParseJobMessageResult {
  return {
    message: {
      parserVersion: "opsflow.job_message_parser.v1",
      batchWarnings: [],
      drafts: [
        {
          clientDraftId: "col-empty",
          movementType: "COLLECTION",
          customerNameText: "Ocean Network Express",
          earliestAt: null,
          latestAt: null,
          timingText: null,
          pickup: { rawText: "PSA, 15/08 @ 2300" },
          delivery: {
            rawText: "Chasen Warehouse, 16 Jalan Buroh, Singapore 128578, #01-01",
          },
          carrier: "Ocean Network Express",
          shipper: "Nippon",
          vessel: "ONE HANNOVER",
          voyage: "101W",
          containerSizeType: null,
          items: [{ containerNumber: "ONEY1234567", sealNumber: null, referenceNumber: null, quantity: 1 }],
          picName: "Shuman",
          picPhone: "96440435",
          instructions: [],
          notes: null,
          sourceFragment: job1SourceFragment,
          fieldEvidence: [],
          warnings: [],
        },
        {
          clientDraftId: "col-loaded",
          movementType: "COLLECTION",
          customerNameText: "Maersk Singapore",
          earliestAt: null,
          latestAt: null,
          timingText: null,
          pickup: { rawText: "Pasir Panjang Terminal, 16/08 @ 0900" },
          delivery: { rawText: "21 Tuas Avenue 3, Singapore 639417, #03-02" },
          carrier: "Maersk",
          shipper: "Pacific Manufacturing",
          vessel: null,
          voyage: null,
          containerSizeType: null,
          items: [{ containerNumber: "MSKU7654321", sealNumber: "SG889921", referenceNumber: null, quantity: 1 }],
          picName: "Daniel",
          picPhone: "91234567",
          instructions: [],
          notes: null,
          sourceFragment: job2SourceFragment,
          fieldEvidence: [],
          warnings: [],
        },
        {
          clientDraftId: "del-1",
          movementType: "LCL",
          customerNameText: "Pacific Logistics",
          earliestAt: null,
          latestAt: null,
          timingText: null,
          pickup: { rawText: "30 Pioneer Road North, Singapore 628471, #02-05" },
          delivery: { rawText: "Jurong Port, 37 Jurong Port Road, Singapore 619110" },
          carrier: null,
          shipper: null,
          vessel: null,
          voyage: null,
          containerSizeType: null,
          items: [],
          picName: "Mei Ling",
          picPhone: "98765432",
          instructions: [],
          notes: null,
          sourceFragment: job3SourceFragment,
          fieldEvidence: [],
          warnings: [],
        },
      ],
    },
    meta: { modelName: "gpt-4.1-mini", usage: null, providerRequestId: "req_prod_wa" },
  };
}

describe("JobMessageImportService production WhatsApp field extraction", () => {
  const audit = { log: jest.fn().mockResolvedValue(undefined) };

  it("uses traceable source fragments for the sample WhatsApp message", () => {
    expect(() =>
      assertSourceFragmentsTraceable(
        productionWhatsAppThreeJobMessage,
        productionWhatsAppParserResult().message.drafts,
      ),
    ).not.toThrow();
  });

  it("extracts pickup timing, postal/unit addresses, instructions, and structured items", async () => {
    const prisma = makePrismaMemory();
    const parser = new StubJobMessageParser(productionWhatsAppParserResult());
    const svc = makeImportSvc(prisma, audit, parser);
    const res = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: productionWhatsAppThreeJobMessage,
    });

    expect(res.drafts).toHaveLength(3);

    const first = res.drafts[0].reviewed;
    expect(first.pickupAddress1).toBe("PSA");
    expect(first.pickupDateLocal).toBe("2026-08-15T23:00");
    expect(first.timingText).toBe("15/08 @ 2300");
    expect(first.deliveryPostal).toBe("128578");
    expect(first.deliveryAddress2).toBe("#01-01");
    expect(first.deliveryAddress1).toBe("Chasen Warehouse, 16 Jalan Buroh");
    expect(first.instructions).toContain("Call PIC 30 minutes before arrival.");
    expect(first.items[0].containerNumber).toBe("ONEY1234567");
    expect(first.items[0].sealNumber).toBeNull();
    expect(first.collectionType).toBe("EMPTY");

    const second = res.drafts[1].reviewed;
    expect(second.deliveryPostal).toBe("639417");
    expect(second.deliveryAddress2).toBe("#03-02");
    expect(second.items[0].containerNumber).toBe("MSKU7654321");
    expect(second.items[0].sealNumber).toBe("SG889921");
    expect(second.instructions).toEqual(["Driver must bring safety vest and helmet."]);
    expect(second.collectionType).toBe("LOADED");

    const third = res.drafts[2].reviewed;
    expect(third.pickupPostal).toBe("628471");
    expect(third.pickupAddress2).toBe("#02-05");
    expect(third.items).toHaveLength(2);
    expect(third.items[0].referenceNumber).toBe("PLT-001");
    expect(third.items[0].quantity).toBe(4);

    for (const draft of res.drafts) {
      const r = draft.reviewed;
      expect(r.pickupAddress1).not.toMatch(/\d{1,2}\/\d{1,2}/);
      expect(r.deliveryAddress1).not.toMatch(/\d{1,2}\/\d{1,2}/);
      expect(r.pickupAddress1).not.toMatch(/@\s*\d/);
      expect(r.deliveryAddress1).not.toMatch(/@\s*\d/);
    }
  });

  it("repairs stale controllerJson that still embeds timing in pickup address on fetch", async () => {
    const prisma = makePrismaMemory();
    const parser = new StubJobMessageParser(productionWhatsAppParserResult());
    const svc = makeImportSvc(prisma, audit, parser);
    const preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: productionWhatsAppThreeJobMessage,
    });
    const draftRow = prisma._state.drafts[0];
    draftRow.controllerJson = {
      ...draftRow.controllerJson,
      pickupAddress1: "PSA, 15/08 @ 2300",
      timingText: null,
      pickupDateLocal: null,
    };

    const fetched = await svc.getBatchPreview({ tenantId: "t1", batchId: preview.batchId });
    expect(fetched.drafts[0].reviewed.pickupAddress1).toBe("PSA");
    expect(fetched.drafts[0].reviewed.pickupDateLocal).toBe("2026-08-15T23:00");
    expect(fetched.drafts[0].reviewed.timingText).toBe("15/08 @ 2300");
  });

  it("persists reviewed instructions and structured items when drafts are confirmed", async () => {
    const prisma = makePrismaMemory();
    const parser = new StubJobMessageParser(productionWhatsAppParserResult());
    const svc = makeImportSvc(prisma, audit, parser);
    let preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: productionWhatsAppThreeJobMessage,
    });

    const job1 = preview.drafts[0];

    for (const d of preview.drafts) {
      preview = await svc.patchDraft({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        draftId: d.id,
        patch: {
          expectedDraftVersion: preview.drafts.find((x) => x.id === d.id)!.draftVersion,
          customerCompanyId: "comp_1",
          inclusionState:
            d.id === job1.id
              ? JobMessageImportDraftInclusionState.INCLUDED
              : JobMessageImportDraftInclusionState.EXCLUDED,
        },
      });
    }

    const readyJob1 = preview.drafts.find((d) => d.id === job1.id)!;

    const confirmed = await svc.confirmBatch({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      drafts: confirmDraftsFromPreview(preview, { ids: [readyJob1.id] }),
    });

    expect(confirmed.createdCount).toBe(1);
    const createdJobs = prisma._state.jobs;
    expect(createdJobs.some((j: { notes: string | null }) => (j.notes ?? "").includes("Call PIC 30 minutes before arrival."))).toBe(true);
    expect(createdJobs.some((j: { pickupAddress1: string }) => j.pickupAddress1 === "PSA")).toBe(true);
    expect(createdJobs[0].items.some((it: { itemCode: string }) => it.itemCode === "ONEY1234567")).toBe(true);
  });

  it("confirms three reviewed drafts in one request from final values", async () => {
    const prisma = makePrismaMemory();
    const parser = new StubJobMessageParser(productionWhatsAppParserResult());
    const svc = makeImportSvc(prisma, audit, parser);
    const preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: productionWhatsAppThreeJobMessage,
    });
    expect(preview.drafts).toHaveLength(3);
    const confirmed = await svc.confirmBatch({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      drafts: confirmDraftsFromPreview(preview, {
        extra: Object.fromEntries(
          preview.drafts.map((d, i) => [d.id, { pickupAddress1: `FINAL PICKUP ${i + 1}` }]),
        ),
      }),
    });
    expect(confirmed.createdCount).toBe(3);
    expect(prisma._state.jobs).toHaveLength(3);
    expect(prisma._state.jobs.map((j: { pickupAddress1: string }) => j.pickupAddress1)).toEqual([
      "FINAL PICKUP 1",
      "FINAL PICKUP 2",
      "FINAL PICKUP 3",
    ]);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      maxWait: 10_000,
      timeout: 20_000,
    });
  });

  it("rejects duplicate draft IDs, foreign customers, and other-tenant batches", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    const preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    const one = confirmDraftsFromPreview(preview, { ids: [preview.drafts[0].id] })[0];
    await expect(
      svc.confirmBatch({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        drafts: [one, { ...one }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      svc.confirmBatch({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        drafts: confirmDraftsFromPreview(preview, {
          ids: [preview.drafts[0].id],
          extra: { [preview.drafts[0].id]: { customerCompanyId: "other_tenant_company" } },
        }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      svc.confirmBatch({
        tenantId: "t2",
        actorUserId: "u1",
        batchId: preview.batchId,
        drafts: confirmDraftsFromPreview(preview, { ids: [preview.drafts[0].id] }),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma._state.jobs).toHaveLength(0);
  });

  it("does not create jobs when confirm is never called", async () => {
    const prisma = makePrismaMemory();
    const svc = makeImportSvc(prisma, audit);
    await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: fixtureMessage,
    });
    expect(prisma._state.jobs).toHaveLength(0);
    expect(prisma._state.batches[0].status).toBe(JobMessageImportBatchStatus.IN_REVIEW);
  });
});

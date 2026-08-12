import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import {
  JobMessageImportBatchStatus,
  JobMessageImportDraftInclusionState,
  JobMessageImportDraftValidationStatus,
  JobMessageImportMovementType,
} from "@prisma/client";
import { FakeJobMessageParser } from "./fake-job-message-parser";
import { JobMessageImportService } from "./job-message-import.service";
import { JobMessageImportDraftValidationStatus as VS } from "@prisma/client";
import type { JobMessageParser, ParseJobMessageInput, ParseJobMessageResult } from "./job-message-parser";
import { FAKE_JOB_MESSAGE_PARSER_VERSION } from "./job-message-import.constants";

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
      create: jest.fn(async ({ data }: any) => {
        const id = `job_${++seq}`;
        const job = { id, ...data, items: data.items?.create ?? [] };
        jobs.push(job);
        for (const it of data.items?.create ?? []) {
          jobItems.push({ ...it, tenantId: data.tenantId, jobId: id, job });
        }
        return job;
      }),
    },
    trip: { create: jest.fn() },
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
      };
      try {
        return await cb(prisma);
      } catch (e) {
        batches.splice(0, batches.length, ...snap.batches);
        drafts.splice(0, drafts.length, ...snap.drafts);
        jobs.splice(0, jobs.length, ...snap.jobs);
        jobItems.splice(0, jobItems.length, ...snap.jobItems);
        throw e;
      }
    }),
    _state: { batches, drafts, jobs, jobItems },
  };
  return prisma;
}

describe("JobMessageImportService workflow", () => {
  const audit = { log: jest.fn().mockResolvedValue(undefined) };

  it("preview persists parsedJson and controllerJson without canonical writes", async () => {
    const prisma = makePrismaMemory();
    const svc = new JobMessageImportService(prisma, audit as any, new FakeJobMessageParser());
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
    const svc = new JobMessageImportService(prisma, audit as any, new FakeJobMessageParser());
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
    const svc = new JobMessageImportService(prisma, audit as any, parser);
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
    const svc = new JobMessageImportService(prisma, audit as any, parser as any);
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
    const svc = new JobMessageImportService(prisma, audit as any, parser as any);
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
    const svc = new JobMessageImportService(prisma, audit as any, new FakeJobMessageParser());
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
    const svc = new JobMessageImportService(prisma, audit as any, new FakeJobMessageParser());
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
    const svc = new JobMessageImportService(prisma, audit as any, new FakeJobMessageParser());
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
    const svc = new JobMessageImportService(prisma, audit as any, new FakeJobMessageParser());
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
      expectedBatchVersion: preview.version,
      selection: included.map((d) => ({
        draftId: d.id,
        expectedDraftVersion: d.draftVersion,
      })),
    });
    expect(first.createdCount).toBe(included.length);
    expect(prisma._state.jobs).toHaveLength(included.length);
    expect(prisma._state.jobs[0].pickupAddress1).toBeTruthy();
    expect(prisma._state.drafts.filter((d: any) => d.canonicalJobId).length).toBe(included.length);

    const again = await svc.confirmBatch({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      expectedBatchVersion: preview.version,
      selection: included.map((d) => ({
        draftId: d.id,
        expectedDraftVersion: d.draftVersion,
      })),
    });
    expect(again.createdJobIds).toEqual(first.createdJobIds);
    expect(prisma._state.jobs).toHaveLength(included.length);
  });

  it("blocks confirmation when an included draft is invalid", async () => {
    const prisma = makePrismaMemory();
    const svc = new JobMessageImportService(prisma, audit as any, new FakeJobMessageParser());
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
        expectedBatchVersion: preview.version,
        selection: preview.drafts
          .filter((d) => d.inclusionState === "INCLUDED")
          .map((d) => ({ draftId: d.id, expectedDraftVersion: d.draftVersion })),
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
    const svc = new JobMessageImportService(prisma, audit as any, new FakeJobMessageParser());
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
        expectedBatchVersion: preview.version,
        selection: [{ draftId: latest.id, expectedDraftVersion: latest.draftVersion }],
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
      expectedBatchVersion: preview.version,
      selection: [{ draftId: ready.id, expectedDraftVersion: ready.draftVersion }],
    });
    expect(confirmed.createdCount).toBe(1);
  });

  it("creates canonical jobs from controllerJson rather than stale parsedJson", async () => {
    const prisma = makePrismaMemory();
    const svc = new JobMessageImportService(prisma, audit as any, new FakeJobMessageParser());
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
          customerCompanyId: "comp_1",
          collectionType: d.reviewed.movementType === "COLLECTION" ? "EMPTY" : undefined,
          inclusionState:
            d.id === imp.id
              ? JobMessageImportDraftInclusionState.INCLUDED
              : JobMessageImportDraftInclusionState.EXCLUDED,
          pickupAddress1: d.id === imp.id ? "CONTROLLER PICKUP" : undefined,
        },
      });
    }
    const latest = preview.drafts.find((d) => d.id === imp.id)!;
    expect(latest.parsed.pickupRawText).not.toBe("CONTROLLER PICKUP");
    const confirmed = await svc.confirmBatch({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      expectedBatchVersion: preview.version,
      selection: [{ draftId: latest.id, expectedDraftVersion: latest.draftVersion }],
    });
    expect(confirmed.createdCount).toBe(1);
    expect(prisma._state.jobs[0].pickupAddress1).toBe("CONTROLLER PICKUP");
    expect(prisma.trip.create).not.toHaveBeenCalled();
  });

  it("rejects stale confirm versions and keeps confirmed batches immutable", async () => {
    const prisma = makePrismaMemory();
    const svc = new JobMessageImportService(prisma, audit as any, new FakeJobMessageParser());
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
        expectedBatchVersion: preview.version + 9,
        selection: preview.drafts.map((d) => ({
          draftId: d.id,
          expectedDraftVersion: d.draftVersion,
        })),
      }),
    ).rejects.toBeInstanceOf(ConflictException);

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
      expectedBatchVersion: preview.version,
      selection: included.map((d) => ({
        draftId: d.id,
        expectedDraftVersion: d.draftVersion,
      })),
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
    const svc = new JobMessageImportService(prisma, audit as any, new FakeJobMessageParser());
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
      expectedBatchVersion: preview.version,
      selection: included.map((d) => ({
        draftId: d.id,
        expectedDraftVersion: d.draftVersion,
      })),
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
    const svc = new JobMessageImportService(prisma, audit as any, new FakeJobMessageParser());
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
    await expect(
      svc.confirmBatch({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        expectedBatchVersion: preview.version,
        selection: included.map((d) => ({
          draftId: d.id,
          expectedDraftVersion: d.draftVersion,
        })),
      }),
    ).rejects.toThrow("forced job create failure");
    expect(prisma._state.jobs).toHaveLength(0);
    expect(prisma._state.batches[0].status).toBe(JobMessageImportBatchStatus.IN_REVIEW);
    expect(prisma._state.batches[0].version).toBe(preview.version);
    expect(prisma._state.drafts.every((d: any) => !d.canonicalJobId)).toBe(true);
    expect(prisma._state.batches[0].version).toBeGreaterThanOrEqual(versionBefore);
  });

  it("reuses the winning IN_REVIEW batch when preview create hits a unique conflict", async () => {
    const prisma = makePrismaMemory();
    const svc = new JobMessageImportService(prisma, audit as any, new FakeJobMessageParser());
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
    const svc = new JobMessageImportService(prisma, audit as any, new FakeJobMessageParser());
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
    const svc = new JobMessageImportService(prisma, audit as any, new FakeJobMessageParser());
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
    const svc = new JobMessageImportService(prisma, audit as any, parser);

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
    const svc = new JobMessageImportService(prisma, audit as any, parser);
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
      const svc = new JobMessageImportService(prisma, audit as any, parser);

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
  "Job 1",
  "COL empty collection for Ocean Network Express",
  "Pickup: PSA, 13/08 @ 2300",
  "Delivery: 10 Pioneer Sector 2",
  "Instruction: Call PIC 30 minutes before arrival.",
  "",
  "Job 2",
  "COL loaded collection for Maersk Singapore",
  "Pickup: Tuas Avenue 9, 14/08 before 1200",
  "Delivery: DB Schenker warehouse",
  "Note: Ensure seal is intact on collection.",
  "",
  "Job 3",
  "DEL delivery for Pacific Logistics",
  "Pickup: Jurong Port",
  "Delivery: 1 North Coast Drive, tomorrow 9am",
  "Instructions: Contact receiver upon arrival.",
].join("\n");

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
          pickup: { rawText: "PSA, 13/08 @ 2300" },
          delivery: { rawText: "10 Pioneer Sector 2" },
          carrier: null,
          shipper: null,
          vessel: null,
          voyage: null,
          containerSizeType: null,
          items: [{ containerNumber: "ONEU1234567", sealNumber: null, referenceNumber: null, quantity: 1 }],
          picName: null,
          picPhone: null,
          instructions: [],
          notes: null,
          sourceFragment: [
            "COL empty collection for Ocean Network Express",
            "Pickup: PSA, 13/08 @ 2300",
            "Delivery: 10 Pioneer Sector 2",
            "Instruction: Call PIC 30 minutes before arrival.",
          ].join("\n"),
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
          pickup: { rawText: "Tuas Avenue 9, 14/08 before 1200" },
          delivery: { rawText: "DB Schenker warehouse" },
          carrier: null,
          shipper: null,
          vessel: null,
          voyage: null,
          containerSizeType: null,
          items: [{ containerNumber: "MSKU9876543", sealNumber: null, referenceNumber: null, quantity: 1 }],
          picName: null,
          picPhone: null,
          instructions: [],
          notes: null,
          sourceFragment: [
            "COL loaded collection for Maersk Singapore",
            "Pickup: Tuas Avenue 9, 14/08 before 1200",
            "Delivery: DB Schenker warehouse",
            "Note: Ensure seal is intact on collection.",
          ].join("\n"),
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
          delivery: { rawText: "1 North Coast Drive, tomorrow 9am" },
          carrier: null,
          shipper: null,
          vessel: null,
          voyage: null,
          containerSizeType: null,
          items: [{ containerNumber: "TCLU5555555", sealNumber: null, referenceNumber: null, quantity: 1 }],
          picName: null,
          picPhone: null,
          instructions: [],
          notes: null,
          sourceFragment: [
            "DEL delivery for Pacific Logistics",
            "Pickup: Jurong Port",
            "Delivery: 1 North Coast Drive, tomorrow 9am",
            "Instructions: Contact receiver upon arrival.",
          ].join("\n"),
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

  it("extracts pickup timing, instructions, and clean addresses from a three-job message", async () => {
    const prisma = makePrismaMemory();
    const parser = new StubJobMessageParser(productionWhatsAppParserResult());
    const svc = new JobMessageImportService(prisma, audit as any, parser);
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
    expect(first.pickupDateLocal).toBe("2026-08-13T23:00");
    expect(first.instructions).toContain("Call PIC 30 minutes before arrival.");

    expect(res.drafts[1].reviewed.instructions).toEqual(["Ensure seal is intact on collection."]);
    expect(res.drafts[2].reviewed.instructions).toEqual(["Contact receiver upon arrival."]);

    for (const draft of res.drafts) {
      const r = draft.reviewed;
      expect(r.pickupAddress1).not.toMatch(/\d{1,2}\/\d{1,2}/);
      expect(r.deliveryAddress1).not.toMatch(/\d{1,2}\/\d{1,2}/);
      expect(r.pickupAddress1).not.toMatch(/@\s*\d/);
      expect(r.deliveryAddress1).not.toMatch(/@\s*\d/);
      expect(r.pickupAddress1).not.toMatch(/tomorrow/i);
      expect(r.deliveryAddress1).not.toMatch(/tomorrow/i);
    }
  });

  it("persists reviewed instructions when drafts are confirmed", async () => {
    const prisma = makePrismaMemory();
    const parser = new StubJobMessageParser(productionWhatsAppParserResult());
    const svc = new JobMessageImportService(prisma, audit as any, parser);
    let preview = await svc.createPreviewBatch({
      tenantId: "t1",
      actorUserId: "u1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP" as any,
      sourceText: productionWhatsAppThreeJobMessage,
    });

    const job1 = preview.drafts[0];
    const job3 = preview.drafts[2];

    for (const d of preview.drafts) {
      preview = await svc.patchDraft({
        tenantId: "t1",
        actorUserId: "u1",
        batchId: preview.batchId,
        draftId: d.id,
        patch: {
          expectedDraftVersion: preview.drafts.find((x) => x.id === d.id)!.draftVersion,
          customerCompanyId: "comp_1",
          collectionType:
            d.id === job1.id ? "EMPTY" : d.reviewed.movementType === "COLLECTION" ? "LOADED" : undefined,
          inclusionState:
            d.id === job1.id || d.id === job3.id
              ? JobMessageImportDraftInclusionState.INCLUDED
              : JobMessageImportDraftInclusionState.EXCLUDED,
        },
      });
    }

    const readyJob1 = preview.drafts.find((d) => d.id === job1.id)!;
    const readyJob3 = preview.drafts.find((d) => d.id === job3.id)!;

    const confirmed = await svc.confirmBatch({
      tenantId: "t1",
      actorUserId: "u1",
      batchId: preview.batchId,
      expectedBatchVersion: preview.version,
      selection: [
        { draftId: readyJob1.id, expectedDraftVersion: readyJob1.draftVersion },
        { draftId: readyJob3.id, expectedDraftVersion: readyJob3.draftVersion },
      ],
    });

    expect(confirmed.createdCount).toBe(2);
    const createdNotes = prisma._state.jobs.map((j: { notes: string | null }) => j.notes ?? "");
    expect(createdNotes.some((n: string) => n.includes("Call PIC 30 minutes before arrival."))).toBe(true);
    expect(createdNotes.some((n: string) => n.includes("Contact receiver upon arrival."))).toBe(true);
  });
});

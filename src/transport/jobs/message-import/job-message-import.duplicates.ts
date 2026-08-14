import type { JobType } from "@prisma/client";
import type { ControllerReviewedDraft, DuplicateCandidate } from "./job-message-import.types";
import { fingerprintHasStrongIdentity, reviewedItemCodes } from "./job-message-import.fingerprint";
import { movementTypeToJobType } from "./job-message-import.validator";

const DUPLICATE_CANDIDATE_LIMIT = 10;

function toYmd(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return null;
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * UTC civil-day window for a YYYY-MM-DD service date.
 * Matches Job.list date filtering in transport-jobs.service.ts
 * (`day + T00:00:00.000Z` .. `day + T23:59:59.999Z`).
 *
 * Manual date-only creates use `YYYY-MM-DDT08:00:00.000Z` (see frontend
 * toIsoDateTimeOrNull); that instant still falls inside this UTC day.
 */
export function utcCivilDayBounds(serviceDateYmd: string): { start: Date; end: Date } {
  const start = new Date(`${serviceDateYmd}T00:00:00.000Z`);
  const end = new Date(`${serviceDateYmd}T23:59:59.999Z`);
  return { start, end };
}

function candidateSortKey(a: DuplicateCandidate, b: DuplicateCandidate): number {
  const ref = a.internalRef.localeCompare(b.internalRef);
  if (ref !== 0) return ref;
  return a.jobId.localeCompare(b.jobId);
}

function toCandidate(job: {
  id: string;
  internalRef?: string | null;
  jobType?: string | null;
  status?: string | null;
  pickupDate?: Date | string | null;
  customerCompanyId?: string | null;
  customerCompany?: { name?: string | null } | null;
  items?: Array<{ itemCode?: string | null }>;
}): DuplicateCandidate {
  const codes = Array.isArray(job.items)
    ? job.items.map((it) => normalizeMatchCode(it.itemCode)).filter(Boolean)
    : [];
  return {
    jobId: job.id,
    internalRef: String(job.internalRef ?? ""),
    jobType: String(job.jobType ?? ""),
    status: String(job.status ?? ""),
    pickupDate: toYmd(job.pickupDate),
    customerCompanyId: job.customerCompanyId ?? null,
    customerName: job.customerCompany?.name ?? null,
    itemCodes: Array.from(new Set(codes)),
  };
}

/**
 * Tenant-scoped, bounded, deterministic duplicate lookup.
 * Prefers container/item codes + service date + job type. Never returns other tenants.
 * Candidates are unique by canonical Job id.
 */
export async function findDuplicateCandidates(params: {
  tx: any;
  tenantId: string;
  requestedPickupDateYmd?: string | null;
  reviewed: ControllerReviewedDraft;
  duplicateFingerprint?: string | null;
  excludeDraftId?: string | null;
  excludeJobIds?: string[];
}): Promise<DuplicateCandidate[]> {
  const byKey = await findDuplicateCandidatesForDrafts({
    tx: params.tx,
    tenantId: params.tenantId,
    drafts: [
      {
        key: "one",
        reviewed: params.reviewed,
        requestedPickupDateYmd: params.requestedPickupDateYmd,
        duplicateFingerprint: params.duplicateFingerprint,
        excludeDraftId: params.excludeDraftId,
        excludeJobIds: params.excludeJobIds,
      },
    ],
  });
  return byKey.get("one") ?? [];
}

type DuplicateDraftLookup = {
  key: string;
  reviewed: ControllerReviewedDraft;
  requestedPickupDateYmd?: string | null;
  duplicateFingerprint?: string | null;
  excludeDraftId?: string | null;
  excludeJobIds?: string[];
};

/**
 * Same semantics as findDuplicateCandidates, batched across drafts that share
 * job type + service date so confirm does not scan JobItems once per draft.
 */
export async function findDuplicateCandidatesForDrafts(params: {
  tx: any;
  tenantId: string;
  drafts: DuplicateDraftLookup[];
}): Promise<Map<string, DuplicateCandidate[]>> {
  const out = new Map<string, DuplicateCandidate[]>();
  const eligible: Array<
    DuplicateDraftLookup & {
      jobType: JobType;
      itemCodes: string[];
      dateYmd: string | null;
    }
  > = [];

  for (const draft of params.drafts) {
    if (!fingerprintHasStrongIdentity(draft.reviewed)) {
      out.set(draft.key, []);
      continue;
    }
    const jobType = movementTypeToJobType(draft.reviewed.movementType);
    if (!jobType) {
      out.set(draft.key, []);
      continue;
    }
    eligible.push({
      ...draft,
      jobType,
      itemCodes: reviewedItemCodes(draft.reviewed),
      dateYmd: draft.requestedPickupDateYmd?.trim() || null,
    });
  }

  type Group = {
    jobType: JobType;
    dateYmd: string | null;
    drafts: typeof eligible;
  };
  const groups = new Map<string, Group>();
  for (const d of eligible) {
    const gk = `${d.jobType}|${d.dateYmd ?? ""}`;
    const g = groups.get(gk) ?? { jobType: d.jobType, dateYmd: d.dateYmd, drafts: [] };
    g.drafts.push(d);
    groups.set(gk, g);
  }

  for (const group of groups.values()) {
    const allCodes = Array.from(new Set(group.drafts.flatMap((d) => d.itemCodes)));
    const pickupDateFilter = group.dateYmd
      ? (() => {
          const { start, end } = utcCivilDayBounds(group.dateYmd);
          return { gte: start, lte: end };
        })()
      : undefined;
    const excludedAll = new Set(group.drafts.flatMap((d) => d.excludeJobIds ?? []));
    const take = Math.min(40 * Math.max(1, group.drafts.length), 200);

    const items = allCodes.length
      ? await params.tx.jobItem.findMany({
          where: {
            tenantId: params.tenantId,
            itemCode: { in: allCodes },
            job: {
              tenantId: params.tenantId,
              jobType: group.jobType,
              ...(pickupDateFilter ? { pickupDate: pickupDateFilter } : {}),
              ...(excludedAll.size ? { id: { notIn: Array.from(excludedAll) } } : {}),
            },
          },
          select: {
            itemCode: true,
            job: {
              select: {
                id: true,
                internalRef: true,
                jobType: true,
                status: true,
                pickupDate: true,
                customerCompanyId: true,
                customerCompany: { select: { name: true } },
                items: { select: { itemCode: true }, take: 20 },
              },
            },
          },
          orderBy: [{ job: { internalRef: "asc" } }, { jobId: "asc" }],
          take,
        })
      : [];

    const byJobIdAll = new Map<string, DuplicateCandidate>();
    for (const row of items) {
      const job = row.job;
      if (!job?.id) continue;
      const existing = byJobIdAll.get(job.id);
      if (existing) {
        const extra = normalizeMatchCode(row.itemCode);
        if (extra && !existing.itemCodes.includes(extra)) existing.itemCodes.push(extra);
        continue;
      }
      byJobIdAll.set(job.id, toCandidate(job));
    }

    const fingerprints = group.drafts
      .map((d) => d.duplicateFingerprint)
      .filter((fp): fp is string => !!fp);
    const needFingerprint = group.drafts.some((d) => {
      const excluded = new Set(d.excludeJobIds ?? []);
      const count = Array.from(byJobIdAll.values()).filter((c) => {
        if (excluded.has(c.jobId)) return false;
        return c.itemCodes.some((code) => d.itemCodes.includes(code));
      }).length;
      return count < DUPLICATE_CANDIDATE_LIMIT && !!d.duplicateFingerprint;
    });

    let extraJobs: Array<{
      id: string;
      internalRef?: string | null;
      jobType?: string | null;
      status?: string | null;
      pickupDate?: Date | string | null;
      customerCompanyId?: string | null;
      customerCompany?: { name?: string | null } | null;
      items?: Array<{ itemCode?: string | null }>;
    }> = [];
    let fingerprintDrafts: Array<{
      id: string;
      canonicalJobId?: string | null;
      duplicateFingerprint?: string | null;
    }> = [];

    if (needFingerprint && fingerprints.length) {
      const excludeDraftIds = group.drafts
        .map((d) => d.excludeDraftId)
        .filter((id): id is string => !!id);
      fingerprintDrafts = await params.tx.jobMessageImportDraft.findMany({
        where: {
          tenantId: params.tenantId,
          duplicateFingerprint: { in: fingerprints },
          confirmedAt: { not: null },
          canonicalJobId: { not: null },
          ...(excludeDraftIds.length ? { id: { notIn: excludeDraftIds } } : {}),
        },
        select: { id: true, canonicalJobId: true, duplicateFingerprint: true },
        take: DUPLICATE_CANDIDATE_LIMIT * Math.max(1, group.drafts.length),
      });
      const extraJobIds = Array.from(
        new Set(
          fingerprintDrafts
            .map((row) => row.canonicalJobId)
            .filter(
              (id: string | null | undefined): id is string =>
                !!id && !byJobIdAll.has(id) && !excludedAll.has(id),
            ),
        ),
      );
      if (extraJobIds.length) {
        extraJobs = await params.tx.job.findMany({
          where: {
            tenantId: params.tenantId,
            id: { in: extraJobIds },
            jobType: group.jobType,
            ...(pickupDateFilter ? { pickupDate: pickupDateFilter } : {}),
          },
          select: {
            id: true,
            internalRef: true,
            jobType: true,
            status: true,
            pickupDate: true,
            customerCompanyId: true,
            customerCompany: { select: { name: true } },
            items: { select: { itemCode: true }, take: 20 },
          },
          orderBy: [{ internalRef: "asc" }, { id: "asc" }],
          take: DUPLICATE_CANDIDATE_LIMIT * Math.max(1, group.drafts.length),
        });
      }
    }

    for (const d of group.drafts) {
      const excluded = new Set(d.excludeJobIds ?? []);
      const byJobId = new Map<string, DuplicateCandidate>();
      for (const cand of byJobIdAll.values()) {
        if (excluded.has(cand.jobId)) continue;
        const overlap = cand.itemCodes.some((code) => d.itemCodes.includes(code));
        if (!overlap) continue;
        byJobId.set(cand.jobId, {
          ...cand,
          itemCodes: cand.itemCodes.filter((code) => d.itemCodes.includes(code) || cand.itemCodes.includes(code)),
        });
      }
      if (byJobId.size < DUPLICATE_CANDIDATE_LIMIT && d.duplicateFingerprint) {
        const allowedJobIds = new Set(
          fingerprintDrafts
            .filter(
              (row) =>
                row.duplicateFingerprint === d.duplicateFingerprint
                && row.id !== d.excludeDraftId,
            )
            .map((row) => row.canonicalJobId)
            .filter((id): id is string => !!id),
        );
        for (const job of extraJobs) {
          if (byJobId.has(job.id) || excluded.has(job.id)) continue;
          if (!allowedJobIds.has(job.id)) continue;
          const jobCodes = (job.items ?? [])
            .map((it) => normalizeMatchCode(it.itemCode))
            .filter(Boolean);
          const overlap = jobCodes.some((c) => d.itemCodes.includes(c));
          if (!overlap) continue;
          byJobId.set(job.id, toCandidate(job));
        }
      }
      out.set(
        d.key,
        Array.from(byJobId.values()).sort(candidateSortKey).slice(0, DUPLICATE_CANDIDATE_LIMIT),
      );
    }
  }

  return out;
}

function normalizeMatchCode(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, "").trim().toUpperCase();
}

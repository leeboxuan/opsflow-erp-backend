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
  if (!fingerprintHasStrongIdentity(params.reviewed)) {
    return [];
  }

  const jobType = movementTypeToJobType(params.reviewed.movementType);
  if (!jobType) return [];

  const itemCodes = reviewedItemCodes(params.reviewed);
  const dateYmd = params.requestedPickupDateYmd?.trim() || null;
  const pickupDateFilter = dateYmd
    ? (() => {
        const { start, end } = utcCivilDayBounds(dateYmd);
        return { gte: start, lte: end };
      })()
    : undefined;
  const byJobId = new Map<string, DuplicateCandidate>();
  const excluded = new Set(params.excludeJobIds ?? []);

  const items = await params.tx.jobItem.findMany({
    where: {
      tenantId: params.tenantId,
      itemCode: { in: itemCodes },
      job: {
        tenantId: params.tenantId,
        jobType: jobType as JobType,
        ...(pickupDateFilter ? { pickupDate: pickupDateFilter } : {}),
        ...(excluded.size ? { id: { notIn: Array.from(excluded) } } : {}),
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
    take: 40,
  });

  for (const row of items) {
    const job = row.job;
    if (!job?.id || excluded.has(job.id)) continue;
    const existing = byJobId.get(job.id);
    if (existing) {
      const extra = normalizeMatchCode(row.itemCode);
      if (extra && !existing.itemCodes.includes(extra)) existing.itemCodes.push(extra);
      continue;
    }
    byJobId.set(job.id, toCandidate(job));
  }

  if (byJobId.size < DUPLICATE_CANDIDATE_LIMIT && params.duplicateFingerprint) {
    const otherDrafts = await params.tx.jobMessageImportDraft.findMany({
      where: {
        tenantId: params.tenantId,
        duplicateFingerprint: params.duplicateFingerprint,
        confirmedAt: { not: null },
        canonicalJobId: { not: null },
        ...(params.excludeDraftId ? { id: { not: params.excludeDraftId } } : {}),
      },
      select: { canonicalJobId: true, duplicateFingerprint: true },
      take: DUPLICATE_CANDIDATE_LIMIT,
    });
    const extraJobIds = otherDrafts
      .map((d: { canonicalJobId?: string | null }) => d.canonicalJobId)
      .filter((id: string | null | undefined): id is string => !!id && !byJobId.has(id) && !excluded.has(id));

    if (extraJobIds.length) {
      const jobs = await params.tx.job.findMany({
        where: {
          tenantId: params.tenantId,
          id: { in: extraJobIds },
          jobType: jobType as JobType,
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
        take: DUPLICATE_CANDIDATE_LIMIT,
      });
      for (const job of jobs) {
        if (byJobId.has(job.id) || excluded.has(job.id)) continue;
        const jobCodes = (job.items ?? [])
          .map((it: { itemCode?: string }) => normalizeMatchCode(it.itemCode))
          .filter(Boolean);
        const overlap = jobCodes.some((c: string) => itemCodes.includes(c));
        if (!overlap) continue;
        byJobId.set(job.id, toCandidate(job));
      }
    }
  }

  return Array.from(byJobId.values()).sort(candidateSortKey).slice(0, DUPLICATE_CANDIDATE_LIMIT);
}

function normalizeMatchCode(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, "").trim().toUpperCase();
}

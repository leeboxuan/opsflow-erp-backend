import { TripStatus } from "@prisma/client";

export const DASHBOARD_ATTENTION_ITEM_LIMIT = 25;
export const UNASSIGNED_STARTING_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

export const DASHBOARD_ATTENTION_TYPES = [
  "unassigned_starting_soon",
  "overdue_active_trip",
  "ready_not_invoiced",
] as const;

export type DashboardAttentionType =
  (typeof DASHBOARD_ATTENTION_TYPES)[number];

export type DashboardAttentionSeverity = "critical" | "warning" | "info";

export type DashboardAttentionEntityType = "TRIP" | "JOB";

export type DashboardAttentionItem = {
  id: string;
  type: DashboardAttentionType;
  severity: DashboardAttentionSeverity;
  entityType: DashboardAttentionEntityType;
  entityId: string;
  title: string;
  reason: string;
  occurredAt: string;
  dueAt: string | null;
  href: string;
};

export type DashboardAttentionCounts = {
  critical: number;
  warning: number;
  info: number;
};

export type DashboardAttention = {
  total: number;
  counts: DashboardAttentionCounts;
  items: DashboardAttentionItem[];
};

export function buildAttentionItemId(
  type: DashboardAttentionType,
  entityId: string,
): string {
  return `${type}:${entityId}`;
}

export function addHours(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

/** Unassigned DRAFT/PUBLISHED trips starting in [now, now+24h). */
export function buildUnassignedStartingSoonWhere(tenantId: string, now: Date) {
  const until = addHours(now, 24);
  return {
    tenantId,
    jobId: { not: null },
    status: { in: [TripStatus.DRAFT, TripStatus.PUBLISHED] },
    plannedStartAt: { gte: now, lt: until },
    assignedDriverUserId: null,
    driverId: null,
  };
}

/** Active trips past a real plannedEndAt (no stale fallback). */
export function buildOverdueActiveTripWhere(tenantId: string, now: Date) {
  return {
    tenantId,
    jobId: { not: null },
    status: { in: [TripStatus.PUBLISHED, TripStatus.ONGOING] },
    plannedEndAt: { not: null, lt: now },
  };
}

export function buildUnassignedStartingSoonItem(input: {
  id: string;
  jobId: string;
  plannedStartAt: Date;
}): DashboardAttentionItem {
  const occurredAt = input.plannedStartAt.toISOString();
  return {
    id: buildAttentionItemId("unassigned_starting_soon", input.id),
    type: "unassigned_starting_soon",
    severity: "critical",
    entityType: "TRIP",
    entityId: input.id,
    title: "Unassigned trip starting soon",
    reason: "No driver is assigned and the trip starts within 24 hours.",
    occurredAt,
    dueAt: occurredAt,
    href: `/jobs/${input.jobId}/workspace?tripId=${input.id}`,
  };
}

export function buildOverdueActiveTripItem(input: {
  id: string;
  jobId: string;
  plannedEndAt: Date;
}): DashboardAttentionItem {
  const occurredAt = input.plannedEndAt.toISOString();
  return {
    id: buildAttentionItemId("overdue_active_trip", input.id),
    type: "overdue_active_trip",
    severity: "critical",
    entityType: "TRIP",
    entityId: input.id,
    title: "Overdue active trip",
    reason: "Active trip is past its planned end time.",
    occurredAt,
    dueAt: occurredAt,
    href: `/jobs/${input.jobId}/workspace?tripId=${input.id}`,
  };
}

export function buildReadyNotInvoicedItem(input: {
  id: string;
  invoiceReadyAt: Date | null;
  updatedAt: Date;
}): DashboardAttentionItem {
  const occurredAt = (input.invoiceReadyAt ?? input.updatedAt).toISOString();
  return {
    id: buildAttentionItemId("ready_not_invoiced", input.id),
    type: "ready_not_invoiced",
    severity: "warning",
    entityType: "JOB",
    entityId: input.id,
    title: "Ready to invoice",
    reason:
      "Job is ready for invoice but has no ISSUED or PAID invoice.",
    occurredAt,
    dueAt: null,
    href: `/invoices/create?jobId=${input.id}`,
  };
}

const SEVERITY_RANK: Record<DashboardAttentionSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const CRITICAL_TYPE_RANK: Record<
  Extract<
    DashboardAttentionType,
    "overdue_active_trip" | "unassigned_starting_soon"
  >,
  number
> = {
  overdue_active_trip: 0,
  unassigned_starting_soon: 1,
};

/**
 * Global attention order:
 * 1. critical before warning
 * 2. within critical: overdue before unassigned
 * 3. within type: earliest dueAt (or occurredAt for warnings)
 * 4. id ascending
 */
export function compareAttentionItems(
  left: DashboardAttentionItem,
  right: DashboardAttentionItem,
): number {
  const severityCmp =
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  if (severityCmp !== 0) return severityCmp;

  if (left.severity === "critical" && right.severity === "critical") {
    const leftTypeRank =
      CRITICAL_TYPE_RANK[
        left.type as keyof typeof CRITICAL_TYPE_RANK
      ] ?? 99;
    const rightTypeRank =
      CRITICAL_TYPE_RANK[
        right.type as keyof typeof CRITICAL_TYPE_RANK
      ] ?? 99;
    if (leftTypeRank !== rightTypeRank) return leftTypeRank - rightTypeRank;
  }

  const leftTime = Date.parse(left.dueAt ?? left.occurredAt);
  const rightTime = Date.parse(right.dueAt ?? right.occurredAt);
  if (leftTime !== rightTime) return leftTime - rightTime;

  return left.id.localeCompare(right.id);
}

export function mergeAttentionItems(
  buckets: DashboardAttentionItem[][],
  limit = DASHBOARD_ATTENTION_ITEM_LIMIT,
): DashboardAttentionItem[] {
  return buckets
    .flat()
    .sort(compareAttentionItems)
    .slice(0, Math.max(0, limit));
}

export function buildDashboardAttention(input: {
  unassignedCount: number;
  overdueCount: number;
  readyNotInvoicedCount: number;
  unassignedItems: DashboardAttentionItem[];
  overdueItems: DashboardAttentionItem[];
  readyNotInvoicedItems: DashboardAttentionItem[];
  limit?: number;
}): DashboardAttention {
  const counts: DashboardAttentionCounts = {
    critical: input.unassignedCount + input.overdueCount,
    warning: input.readyNotInvoicedCount,
    info: 0,
  };
  return {
    total: counts.critical + counts.warning + counts.info,
    counts,
    items: mergeAttentionItems(
      [
        input.overdueItems,
        input.unassignedItems,
        input.readyNotInvoicedItems,
      ],
      input.limit ?? DASHBOARD_ATTENTION_ITEM_LIMIT,
    ),
  };
}

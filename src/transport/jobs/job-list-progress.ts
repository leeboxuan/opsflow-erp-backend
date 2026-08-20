import { InvoiceStatus, JobStatus, Prisma, TripStatus } from "@prisma/client";
import {
  evaluateJobInvoiceReadiness,
  isInvoiceReadyTripStatus,
} from "./job-invoice-readiness";

export const JOB_LIST_TRIP_PROGRESS_VALUES = [
  "incomplete",
  "complete",
  "none",
  "cancelled",
] as const;

export const JOB_LIST_INVOICE_STATUS_VALUES = [
  "not_available",
  "waiting",
  "DRAFT",
  "GENERATED",
  "ISSUED",
  "PAID",
  "VOID",
] as const;

export const JOB_LIST_SORT_FIELDS = [
  "createdAt",
  "updatedAt",
  "pickupDate",
  "startedAt",
  "internalRef",
  "externalRef",
  "status",
] as const;

export const JOB_LIST_SEARCH_FIELDS = [
  "internalRef",
  "pickupAddress1",
  "deliveryAddress1",
  "receiverName",
  "receiverPhone",
  "externalRef",
] as const;

export type JobListTripProgressFilter =
  (typeof JOB_LIST_TRIP_PROGRESS_VALUES)[number];
export type JobListInvoiceStatusFilter =
  (typeof JOB_LIST_INVOICE_STATUS_VALUES)[number];
export type JobListTripProgressPredicate =
  | JobListTripProgressFilter
  | "not_complete";

export type JobListTripProgress = {
  completed: number;
  total: number;
  isComplete: boolean;
};

export type JobListInvoiceRef = {
  id: string;
  status: InvoiceStatus;
  createdAt?: Date | string | null;
};

const OPERATIONAL_INCOMPLETE_STATUSES: TripStatus[] = [
  TripStatus.DRAFT,
  TripStatus.PUBLISHED,
  TripStatus.ONGOING,
];

const LEGACY_JOB_STATUS_FILTER: Record<string, JobStatus> = {
  ONGOING: JobStatus.ONGOING,
  READY_FOR_INVOICE: JobStatus.READY_FOR_INVOICE,
  COMPLETED: JobStatus.COMPLETED,
  CANCELLED: JobStatus.CANCELLED,
};

const SEARCH_SQL: Record<(typeof JOB_LIST_SEARCH_FIELDS)[number], Prisma.Sql> = {
  internalRef: Prisma.sql`j."internalRef"`,
  pickupAddress1: Prisma.sql`j."pickupAddress1"`,
  deliveryAddress1: Prisma.sql`j."deliveryAddress1"`,
  receiverName: Prisma.sql`j."receiverName"`,
  receiverPhone: Prisma.sql`j."receiverPhone"`,
  externalRef: Prisma.sql`j."externalRef"`,
};

const SORT_SQL: Record<(typeof JOB_LIST_SORT_FIELDS)[number], Prisma.Sql> = {
  createdAt: Prisma.sql`j."createdAt"`,
  updatedAt: Prisma.sql`j."updatedAt"`,
  pickupDate: Prisma.sql`j."pickupDate"`,
  startedAt: Prisma.sql`j."startedAt"`,
  internalRef: Prisma.sql`j."internalRef"`,
  externalRef: Prisma.sql`j."externalRef"`,
  status: Prisma.sql`j."status"`,
};

export type JobListQueryConstraints = {
  tenantId: string;
  companyScopeId?: string;
  search?: string;
  jobStatus?: string;
  legacyFilter?: string;
  /** Contains semantics: job has this type among assignments or legacy singular. */
  jobType?: string;
  tripProgress?: JobListTripProgressFilter;
  invoiceStatus?: JobListInvoiceStatusFilter;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortDir?: string;
};

/**
 * Canonical Jobs-list invoice column: the newest Invoice linked by
 * `Invoice.sourceJobId`. Tie-break `createdAt DESC`, then `id DESC`.
 *
 * `sourceJobId` is not unique: a Job may have several invoices (charge split,
 * void-and-recreate, remaining unreserved charges). There is no Job→Invoice
 * Prisma relation and no current-invoice pointer on Job.
 */
export function tripProgressFromTrips(
  trips: Array<{ id?: string; status: TripStatus }>,
): JobListTripProgress {
  const readiness = evaluateJobInvoiceReadiness(
    trips.map((trip, index) => ({
      id: trip.id ?? `trip-${index}`,
      status: trip.status,
    })),
  );
  return {
    completed: trips.filter((trip) => isInvoiceReadyTripStatus(trip.status))
      .length,
    total: readiness.billableTripCount,
    isComplete: readiness.readyForInvoice,
  };
}

export type JobListInvoiceDisplayStatus =
  | "NOT_AVAILABLE"
  | "WAITING"
  | InvoiceStatus;

export function jobListInvoiceDisplayStatus(
  progress: JobListTripProgress,
  invoice: JobListInvoiceRef | null,
): JobListInvoiceDisplayStatus {
  if (invoice) return invoice.status;
  return progress.isComplete ? "WAITING" : "NOT_AVAILABLE";
}

export function invoiceStatusFilterMatchesDisplay(
  filter: JobListInvoiceStatusFilter,
  display: JobListInvoiceDisplayStatus,
): boolean {
  if (filter === "not_available") return display === "NOT_AVAILABLE";
  if (filter === "waiting") return display === "WAITING";
  return display === filter;
}

export function jobMatchesInvoiceStatusFilter(
  filter: JobListInvoiceStatusFilter | undefined,
  progress: JobListTripProgress,
  invoice: JobListInvoiceRef | null,
): boolean {
  if (!filter) return true;
  return invoiceStatusFilterMatchesDisplay(
    filter,
    jobListInvoiceDisplayStatus(progress, invoice),
  );
}

export function invoiceStatusImpliedTripPredicate(
  filter: JobListInvoiceStatusFilter | undefined,
): JobListTripProgressPredicate | undefined {
  if (filter === "waiting") return "complete";
  if (filter === "not_available") return "not_complete";
  return undefined;
}

function invoiceCreatedAtMs(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/** Newest linked invoice: createdAt DESC, then id DESC. */
export function compareJobListInvoicesNewestFirst(
  a: { id: string; createdAt?: Date | string | null },
  b: { id: string; createdAt?: Date | string | null },
): number {
  const byCreated = invoiceCreatedAtMs(b.createdAt) - invoiceCreatedAtMs(a.createdAt);
  if (byCreated !== 0) return byCreated;
  if (b.id > a.id) return 1;
  if (b.id < a.id) return -1;
  return 0;
}

export function indexLatestInvoicesByJobId<
  T extends {
    id: string;
    status: InvoiceStatus;
    sourceJobId: string | null;
    createdAt?: Date | string | null;
  },
>(invoices: T[]): Map<string, JobListInvoiceRef> {
  const latest = new Map<string, JobListInvoiceRef>();
  const sorted = [...invoices].sort(compareJobListInvoicesNewestFirst);
  for (const invoice of sorted) {
    if (!invoice.sourceJobId || latest.has(invoice.sourceJobId)) continue;
    latest.set(invoice.sourceJobId, {
      id: invoice.id,
      status: invoice.status,
      createdAt: invoice.createdAt ?? null,
    });
  }
  return latest;
}

export function tripProgressPrismaWhere(
  filter: JobListTripProgressPredicate | undefined,
): Record<string, unknown> | null {
  if (!filter) return null;
  const completeWhere = {
    AND: [
      {
        trips: {
          some: { status: { in: [TripStatus.COMPLETED, TripStatus.DONE] } },
        },
      },
      {
        trips: {
          none: { status: { in: OPERATIONAL_INCOMPLETE_STATUSES } },
        },
      },
    ],
  };
  switch (filter) {
    case "complete":
      return completeWhere;
    case "not_complete":
      return { NOT: completeWhere };
    case "incomplete":
      return {
        trips: { some: { status: { in: OPERATIONAL_INCOMPLETE_STATUSES } } },
      };
    case "none":
      return {
        trips: { none: { status: { not: TripStatus.CANCELLED } } },
      };
    case "cancelled":
      return { status: JobStatus.CANCELLED };
    default:
      return null;
  }
}

function utcDayStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function utcDayEnd(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999Z`);
}

function tripStatusInSql(statuses: TripStatus[]): Prisma.Sql {
  return Prisma.join(
    statuses.map((status) => Prisma.sql`${status}::"TripStatus"`),
  );
}

/**
 * Prisma cannot express "status of the latest invoice for this job":
 * Job has no `invoices` relation, `sourceJobId` is non-unique, and Prisma where
 * has no DISTINCT ON / window functions. A `some: { status }` predicate would
 * match any historical invoice, not the canonical newest one.
 *
 * This correlated subquery is tenant-scoped, uses bound parameters, and runs
 * as part of the paginated jobs query (LIMIT/OFFSET). PostgreSQL can satisfy
 * it with an index lookup on `(tenantId, sourceJobId)` per candidate job
 * rather than loading tenant invoice history into Node.
 */
export function jobListLatestInvoiceStatusSql(tenantId: string): Prisma.Sql {
  return Prisma.sql`(
    SELECT i."status"
    FROM invoices i
    WHERE i."tenantId" = ${tenantId}
      AND i."sourceJobId" = j.id
    ORDER BY i."createdAt" DESC, i.id DESC
    LIMIT 1
  )`;
}

export function jobListHasLinkedInvoiceSql(tenantId: string): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM invoices i
    WHERE i."tenantId" = ${tenantId}
      AND i."sourceJobId" = j.id
  )`;
}

export function jobListInvoiceStatusPredicateSql(
  tenantId: string,
  filter: JobListInvoiceStatusFilter,
): Prisma.Sql {
  if (filter === "not_available" || filter === "waiting") {
    return Prisma.sql`NOT ${jobListHasLinkedInvoiceSql(tenantId)}`;
  }
  return Prisma.sql`${jobListLatestInvoiceStatusSql(tenantId)} = ${filter}::"InvoiceStatus"`;
}

export function tripProgressSql(
  filter: JobListTripProgressPredicate,
): Prisma.Sql {
  const incompleteExists = Prisma.sql`EXISTS (
    SELECT 1 FROM trips t
    WHERE t."jobId" = j.id
      AND t."tenantId" = j."tenantId"
      AND t."status" IN (${tripStatusInSql(OPERATIONAL_INCOMPLETE_STATUSES)})
  )`;
  const completeExists = Prisma.sql`EXISTS (
    SELECT 1 FROM trips t
    WHERE t."jobId" = j.id
      AND t."tenantId" = j."tenantId"
      AND t."status" IN (${tripStatusInSql([TripStatus.COMPLETED, TripStatus.DONE])})
  )`;
  switch (filter) {
    case "incomplete":
      return incompleteExists;
    case "complete":
      return Prisma.sql`(${completeExists} AND NOT ${incompleteExists})`;
    case "not_complete":
      return Prisma.sql`NOT (${completeExists} AND NOT ${incompleteExists})`;
    case "none":
      return Prisma.sql`NOT EXISTS (
        SELECT 1 FROM trips t
        WHERE t."jobId" = j.id
          AND t."tenantId" = j."tenantId"
          AND t."status" <> ${TripStatus.CANCELLED}::"TripStatus"
      )`;
    case "cancelled":
      return Prisma.sql`j."status" = ${JobStatus.CANCELLED}::"JobStatus"`;
  }
}

function pickupOrPlannedDateSql(
  pickupRange: { gte?: Date; lte?: Date },
  tripRange: { gte?: Date; lte?: Date },
): Prisma.Sql {
  const pickupParts: Prisma.Sql[] = [];
  const tripParts: Prisma.Sql[] = [];
  if (pickupRange.gte) pickupParts.push(Prisma.sql`j."pickupDate" >= ${pickupRange.gte}`);
  if (pickupRange.lte) pickupParts.push(Prisma.sql`j."pickupDate" <= ${pickupRange.lte}`);
  if (tripRange.gte) tripParts.push(Prisma.sql`t."plannedStartAt" >= ${tripRange.gte}`);
  if (tripRange.lte) tripParts.push(Prisma.sql`t."plannedStartAt" <= ${tripRange.lte}`);
  const pickupSql =
    pickupParts.length > 0
      ? Prisma.join(pickupParts, " AND ")
      : Prisma.sql`j."pickupDate" IS NOT NULL`;
  const tripSql =
    tripParts.length > 0
      ? Prisma.sql`EXISTS (
          SELECT 1 FROM trips t
          WHERE t."jobId" = j.id
            AND t."tenantId" = j."tenantId"
            AND ${Prisma.join(tripParts, " AND ")}
        )`
      : Prisma.sql`EXISTS (
          SELECT 1 FROM trips t
          WHERE t."jobId" = j.id
            AND t."tenantId" = j."tenantId"
            AND t."plannedStartAt" IS NOT NULL
        )`;
  return Prisma.sql`((${pickupSql}) OR (${tripSql}))`;
}

export function jobListSharedFilterParts(c: JobListQueryConstraints): {
  prismaAnd: Record<string, unknown>[];
  sqlParts: Prisma.Sql[];
} {
  const access: Record<string, unknown> = { tenantId: c.tenantId };
  if (c.companyScopeId) access.customerCompanyId = c.companyScopeId;
  const prismaAnd: Record<string, unknown>[] = [access];
  const sqlParts: Prisma.Sql[] = [Prisma.sql`j."tenantId" = ${c.tenantId}`];

  if (c.companyScopeId) {
    sqlParts.push(Prisma.sql`j."customerCompanyId" = ${c.companyScopeId}`);
  }

  if (
    c.jobStatus &&
    (Object.values(JobStatus) as string[]).includes(c.jobStatus)
  ) {
    prismaAnd.push({ status: c.jobStatus as JobStatus });
    sqlParts.push(Prisma.sql`j."status" = ${c.jobStatus}::"JobStatus"`);
  }

  const legacyStatus = c.legacyFilter
    ? LEGACY_JOB_STATUS_FILTER[c.legacyFilter]
    : undefined;
  if (legacyStatus) {
    prismaAnd.push({ status: legacyStatus });
    sqlParts.push(Prisma.sql`j."status" = ${legacyStatus}::"JobStatus"`);
  }

  const jobTypeFilter = c.jobType?.trim();
  if (jobTypeFilter) {
    // Contains semantics without duplicating jobs: assignment OR legacy singular.
    prismaAnd.push({
      OR: [
        {
          jobTypeAssignments: {
            some: { tenantId: c.tenantId, jobType: jobTypeFilter },
          },
        },
        { jobType: jobTypeFilter },
      ],
    });
    sqlParts.push(
      Prisma.sql`(
        EXISTS (
          SELECT 1 FROM job_type_assignments jta
          WHERE jta."jobId" = j.id
            AND jta."tenantId" = ${c.tenantId}
            AND jta."jobType" = ${jobTypeFilter}::"JobType"
        )
        OR j."jobType" = ${jobTypeFilter}::"JobType"
      )`,
    );
  }

  const day = c.date?.trim();
  const from = c.dateFrom?.trim();
  const to = c.dateTo?.trim();
  if (day) {
    const dayStart = utcDayStart(day);
    const dayEnd = utcDayEnd(day);
    prismaAnd.push({
      OR: [
        { pickupDate: { gte: dayStart, lte: dayEnd } },
        {
          trips: {
            some: { plannedStartAt: { gte: dayStart, lte: dayEnd } },
          },
        },
      ],
    });
    sqlParts.push(
      pickupOrPlannedDateSql(
        { gte: dayStart, lte: dayEnd },
        { gte: dayStart, lte: dayEnd },
      ),
    );
  } else if (from || to) {
    const pickupRange: { gte?: Date; lte?: Date } = {};
    const tripRange: { gte?: Date; lte?: Date } = {};
    if (from) {
      pickupRange.gte = utcDayStart(from);
      tripRange.gte = utcDayStart(from);
    }
    if (to) {
      pickupRange.lte = utcDayEnd(to);
      tripRange.lte = utcDayEnd(to);
    }
    prismaAnd.push({
      OR: [
        { pickupDate: pickupRange },
        { trips: { some: { plannedStartAt: tripRange } } },
      ],
    });
    sqlParts.push(pickupOrPlannedDateSql(pickupRange, tripRange));
  }

  const search = c.search?.trim();
  if (search) {
    prismaAnd.push({
      OR: JOB_LIST_SEARCH_FIELDS.map((field) => ({
        [field]: { contains: search, mode: "insensitive" as const },
      })),
    });
    sqlParts.push(
      Prisma.sql`(${Prisma.join(
        JOB_LIST_SEARCH_FIELDS.map(
          (field) => Prisma.sql`${SEARCH_SQL[field]} ILIKE ${`%${search}%`}`,
        ),
        " OR ",
      )})`,
    );
  }

  const tripWhere = tripProgressPrismaWhere(c.tripProgress);
  if (tripWhere) {
    prismaAnd.push(tripWhere);
    sqlParts.push(tripProgressSql(c.tripProgress!));
  }

  const impliedTrip = invoiceStatusImpliedTripPredicate(c.invoiceStatus);
  if (impliedTrip) {
    const impliedWhere = tripProgressPrismaWhere(impliedTrip);
    if (impliedWhere) prismaAnd.push(impliedWhere);
    sqlParts.push(tripProgressSql(impliedTrip));
  }

  return { prismaAnd, sqlParts };
}

export function jobListPrismaWhere(
  c: JobListQueryConstraints,
): Record<string, unknown> {
  return { AND: jobListSharedFilterParts(c).prismaAnd };
}

export function jobListFilterWhereSql(c: JobListQueryConstraints): Prisma.Sql {
  const { sqlParts } = jobListSharedFilterParts(c);
  if (c.invoiceStatus) {
    sqlParts.push(
      jobListInvoiceStatusPredicateSql(c.tenantId, c.invoiceStatus),
    );
  }
  return Prisma.join(sqlParts, " AND ");
}

export function jobListOrderBySql(
  sortBy?: string,
  sortDir?: string,
): Prisma.Sql {
  const column =
    sortBy && (JOB_LIST_SORT_FIELDS as readonly string[]).includes(sortBy)
      ? SORT_SQL[sortBy as (typeof JOB_LIST_SORT_FIELDS)[number]]
      : SORT_SQL.createdAt;
  const descending = sortBy
    ? sortDir === "desc"
    : true;
  const dir = descending ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  return Prisma.sql`${column} ${dir}`;
}

export function jobListFilteredCountSql(c: JobListQueryConstraints): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM jobs j
    WHERE ${jobListFilterWhereSql(c)}
  `;
}

export function jobListFilteredPageIdsSql(
  c: JobListQueryConstraints,
  skip: number,
  take: number,
): Prisma.Sql {
  return Prisma.sql`
    SELECT j.id
    FROM jobs j
    WHERE ${jobListFilterWhereSql(c)}
    ORDER BY ${jobListOrderBySql(c.sortBy, c.sortDir)}
    LIMIT ${take} OFFSET ${skip}
  `;
}

export function jobListPageInvoiceQuery(tenantId: string, jobIds: string[]) {
  return {
    where: { tenantId, sourceJobId: { in: jobIds } },
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    select: {
      id: true,
      status: true,
      sourceJobId: true,
      createdAt: true,
    },
  };
}

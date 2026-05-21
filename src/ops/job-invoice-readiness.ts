import { BadRequestException } from "@nestjs/common";
import { JobStatus, TripStatus } from "@prisma/client";

export type InvoiceReadinessInputTrip = {
  id: string;
  status: TripStatus;
};

export type InvoiceReadinessResult = {
  readyForInvoice: boolean;
  blockingTrips: Array<{ id: string; status: TripStatus }>;
  billableTripCount: number;
  reason: string;
};

export const JOBS_WITH_TRIPS_CANNOT_CANCEL_OR_DELETE_MSG =
  "Jobs with trips cannot be cancelled or deleted. Remove trips first.";

export function assertJobHasNoTripsForCancelOrDelete(tripCount: number): void {
  if (tripCount > 0) {
    throw new BadRequestException(JOBS_WITH_TRIPS_CANNOT_CANCEL_OR_DELETE_MSG);
  }
}

export function isInvoiceReadyTripStatus(status: TripStatus): boolean {
  return status === TripStatus.COMPLETED || status === TripStatus.DONE;
}

export function evaluateJobInvoiceReadiness(
  trips: InvoiceReadinessInputTrip[],
): InvoiceReadinessResult {
  const billableTrips = trips.filter((trip) => trip.status !== TripStatus.CANCELLED);
  const blockingTrips = billableTrips
    .filter((trip) => !isInvoiceReadyTripStatus(trip.status))
    .map((trip) => ({ id: trip.id, status: trip.status }));

  if (billableTrips.length === 0) {
    return {
      readyForInvoice: false,
      blockingTrips: [],
      billableTripCount: 0,
      reason: "No completed trips available for invoicing.",
    };
  }

  if (blockingTrips.length > 0) {
    return {
      readyForInvoice: false,
      blockingTrips,
      billableTripCount: billableTrips.length,
      reason: "All non-cancelled trips must be completed or done before invoicing.",
    };
  }

  return {
    readyForInvoice: true,
    blockingTrips: [],
    billableTripCount: billableTrips.length,
    reason: "All non-cancelled trips are completed or done.",
  };
}

export type JobInvoiceSyncPrisma = {
  job: {
    findFirst: (
      args: unknown,
    ) => Promise<{
      id: string;
      status: JobStatus;
      invoiceReadyAt: Date | null;
    } | null>;
    update: (args: unknown) => Promise<unknown>;
  };
  trip: {
    findMany: (
      args: unknown,
    ) => Promise<Array<{ id: string; status: TripStatus }>>;
  };
};

export type JobInvoiceSyncResult = InvoiceReadinessResult & {
  jobId: string;
  status: JobStatus;
  invoiceReadyAt: Date | null;
  isInvoiceReady: boolean;
  changed: boolean;
  skipped: boolean;
  dryRun: boolean;
};

export type SyncJobInvoiceReadinessOptions = {
  /** When true, compute changes but do not persist job updates. */
  dryRun?: boolean;
  /** Used when setting invoiceReadyAt for newly-ready jobs (default: now). */
  invoiceReadyAtNow?: Date;
};

export async function syncJobInvoiceReadiness(
  prisma: JobInvoiceSyncPrisma,
  tenantId: string,
  jobId: string,
  options?: SyncJobInvoiceReadinessOptions,
): Promise<JobInvoiceSyncResult | null> {
  const dryRun = options?.dryRun ?? false;
  const invoiceReadyAtNow = options?.invoiceReadyAtNow ?? new Date();
  const job = await prisma.job.findFirst({
    where: { id: jobId, tenantId },
    select: { id: true, status: true, invoiceReadyAt: true },
  });
  if (!job) return null;

  if (job.status === JobStatus.CANCELLED || job.status === JobStatus.COMPLETED) {
    const trips = await prisma.trip.findMany({
      where: { tenantId, jobId },
      select: { id: true, status: true },
    });
    const readiness = evaluateJobInvoiceReadiness(
      trips.map((trip) => ({ id: trip.id, status: trip.status })),
    );
    return {
      ...readiness,
      jobId,
      status: job.status,
      invoiceReadyAt: job.invoiceReadyAt,
      isInvoiceReady: false,
      changed: false,
      skipped: true,
      dryRun,
    };
  }

  const trips = await prisma.trip.findMany({
    where: { tenantId, jobId },
    select: { id: true, status: true },
  });

  const readiness = evaluateJobInvoiceReadiness(
    trips.map((trip) => ({ id: trip.id, status: trip.status })),
  );

  const nextStatus = readiness.readyForInvoice
    ? JobStatus.READY_FOR_INVOICE
    : JobStatus.ONGOING;
  const nextInvoiceReadyAt = readiness.readyForInvoice
    ? (job.invoiceReadyAt ?? invoiceReadyAtNow)
    : null;

  const statusChanged = job.status !== nextStatus;
  const invoiceReadyAtChanged =
    (job.invoiceReadyAt?.getTime() ?? null) !== (nextInvoiceReadyAt?.getTime() ?? null);
  const changed = statusChanged || invoiceReadyAtChanged;

  if (changed && !dryRun) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: nextStatus,
        invoiceReadyAt: nextInvoiceReadyAt,
      },
    });
  }

  return {
    ...readiness,
    jobId,
    status: nextStatus,
    invoiceReadyAt: nextInvoiceReadyAt,
    isInvoiceReady: nextStatus === JobStatus.READY_FOR_INVOICE,
    changed,
    skipped: false,
    dryRun,
  };
}

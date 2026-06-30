import type { Role, TripStatus } from "@prisma/client";
import type { RealtimeEventsService } from "./realtime-events.service";
import type {
  RealtimeEntityType,
  RealtimeEventInput,
  RealtimeNotificationContext,
} from "./realtime-event.types";

type PublishContextOpts = Partial<RealtimeNotificationContext> & {
  actorUserId?: string | null;
  actorRole?: Role | null;
  tripStatus?: TripStatus | null;
  notificationKind?: string;
  documentTypeLabel?: string;
  earningsAmountCents?: number;
};

function publish(
  svc: RealtimeEventsService | undefined,
  event: RealtimeEventInput,
): void {
  svc?.publish(event);
}

export function publishJobEvent(
  svc: RealtimeEventsService | undefined,
  type: string,
  tenantId: string,
  jobId: string,
  opts?: PublishContextOpts & { reason?: string; driverUserId?: string | null },
): void {
  publish(svc, {
    type,
    tenantId,
    entityType: "job",
    entityId: jobId,
    jobId,
    driverUserId: opts?.driverUserId ?? undefined,
    reason: opts?.reason,
    jobInternalRef: opts?.jobInternalRef,
    customerCompanyName: opts?.customerCompanyName,
    actorUserId: opts?.actorUserId ?? undefined,
    actorRole: opts?.actorRole ?? undefined,
    tripStatus: opts?.tripStatus ?? undefined,
    notificationKind: opts?.notificationKind,
    documentTypeLabel: opts?.documentTypeLabel,
    earningsAmountCents: opts?.earningsAmountCents,
  });
  svc?.publishDispatchAndDashboard(tenantId, {
    jobId,
    reason: type,
    driverUserId: opts?.driverUserId ?? undefined,
  });
}

export function publishTripEvent(
  svc: RealtimeEventsService | undefined,
  type: string,
  tenantId: string,
  jobId: string,
  tripId: string,
  opts?: PublishContextOpts & { driverUserId?: string | null; reason?: string },
): void {
  publish(svc, {
    type,
    tenantId,
    entityType: "trip",
    entityId: tripId,
    jobId,
    tripId,
    driverUserId: opts?.driverUserId ?? undefined,
    reason: opts?.reason,
    jobInternalRef: opts?.jobInternalRef,
    customerCompanyName: opts?.customerCompanyName,
    tripDisplayRef: opts?.tripDisplayRef,
    assignedDriverName: opts?.assignedDriverName,
    vehicleNumber: opts?.vehicleNumber,
    actorUserId: opts?.actorUserId ?? undefined,
    actorRole: opts?.actorRole ?? undefined,
    tripStatus: opts?.tripStatus ?? undefined,
    notificationKind: opts?.notificationKind,
    documentTypeLabel: opts?.documentTypeLabel,
    earningsAmountCents: opts?.earningsAmountCents,
  });
  svc?.publishDispatchAndDashboard(tenantId, {
    jobId,
    tripId,
    driverUserId: opts?.driverUserId ?? undefined,
    reason: type,
  });
}

export function publishDocumentEvent(
  svc: RealtimeEventsService | undefined,
  type: string,
  tenantId: string,
  documentId: string,
  opts: PublishContextOpts & {
    jobId?: string;
    tripId?: string;
    driverUserId?: string | null;
    reason?: string;
  },
): void {
  publish(svc, {
    type,
    tenantId,
    entityType: "document",
    entityId: documentId,
    jobId: opts.jobId,
    tripId: opts.tripId,
    driverUserId: opts.driverUserId ?? undefined,
    reason: opts.reason,
    jobInternalRef: opts.jobInternalRef,
    customerCompanyName: opts.customerCompanyName,
    tripDisplayRef: opts.tripDisplayRef,
    assignedDriverName: opts.assignedDriverName,
    vehicleNumber: opts.vehicleNumber,
    actorUserId: opts.actorUserId ?? undefined,
    actorRole: opts.actorRole ?? undefined,
    tripStatus: opts.tripStatus ?? undefined,
    notificationKind: opts.notificationKind,
    documentTypeLabel: opts.documentTypeLabel,
    earningsAmountCents: opts.earningsAmountCents,
  });
  svc?.publishDispatchAndDashboard(tenantId, {
    jobId: opts.jobId,
    tripId: opts.tripId,
    driverUserId: opts.driverUserId ?? undefined,
    reason: type,
  });
}

export function publishDriverActiveJobsUpdated(
  svc: RealtimeEventsService | undefined,
  tenantId: string,
  driverUserId: string,
): void {
  publish(svc, {
    type: "driver.active-jobs.updated",
    tenantId,
    entityType: "driver",
    entityId: driverUserId,
    driverUserId,
  });
}

export function publishDriverEvent(
  svc: RealtimeEventsService | undefined,
  type: string,
  tenantId: string,
  driverUserId: string,
): void {
  publish(svc, {
    type,
    tenantId,
    entityType: "driver",
    entityId: driverUserId,
    driverUserId,
  });
  svc?.publishDispatchAndDashboard(tenantId, { driverUserId, reason: type });
}

export function publishVehicleEvent(
  svc: RealtimeEventsService | undefined,
  type: string,
  tenantId: string,
  vehicleId: string,
): void {
  publish(svc, {
    type,
    tenantId,
    entityType: "vehicle",
    entityId: vehicleId,
  });
  svc?.publishDispatchAndDashboard(tenantId, { reason: type });
}

export function publishCustomerEvent(
  svc: RealtimeEventsService | undefined,
  type: string,
  tenantId: string,
  customerId: string,
): void {
  publish(svc, {
    type,
    tenantId,
    entityType: "customer",
    entityId: customerId,
  });
  svc?.publishDispatchAndDashboard(tenantId, { reason: type });
}

export function publishInvoiceEvent(
  svc: RealtimeEventsService | undefined,
  type: string,
  tenantId: string,
  invoiceId: string,
  opts?: { jobId?: string | null; reason?: string },
): void {
  publish(svc, {
    type,
    tenantId,
    entityType: "dashboard",
    entityId: invoiceId,
    jobId: opts?.jobId ?? undefined,
    reason: opts?.reason,
  });
  svc?.publishDispatchAndDashboard(tenantId, {
    jobId: opts?.jobId ?? undefined,
    reason: type,
  });
}

export function publishEntityEvent(
  svc: RealtimeEventsService | undefined,
  type: string,
  tenantId: string,
  entityType: RealtimeEntityType,
  entityId: string,
  partial?: Omit<RealtimeEventInput, "type" | "tenantId" | "entityType" | "entityId">,
): void {
  publish(svc, {
    type,
    tenantId,
    entityType,
    entityId,
    ...partial,
  });
}

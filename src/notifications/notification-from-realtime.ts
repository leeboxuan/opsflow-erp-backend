import {
  NotificationAudience,
  NotificationSeverity,
  Role,
} from "@prisma/client";
import type { RealtimeEvent } from "../realtime/realtime-event.types";
import {
  buildNotificationMetadataFromEvent,
  documentNotificationDescription,
  jobNotificationDescription,
  tripNotificationDescription,
} from "./notification-display-context";

export const PERSISTED_NOTIFICATION_EVENT_TYPES = new Set([
  "job.created",
  "job.cancelled",
  "trip.assigned",
  "trip.unassigned",
  "trip.published",
  "trip.updated",
  "trip.unpublished",
  "trip.started",
  "trip.completed",
  "trip.done",
  "trip.cancelled",
  "document.uploaded",
  "document.signed",
  "document.deleted",
  "driver.created",
  "driver.updated",
  "driver.deleted",
  "vehicle.created",
  "vehicle.updated",
  "vehicle.deleted",
  "invoice.generated",
]);

const SKIPPED_EVENT_TYPES = new Set([
  "heartbeat",
  "dashboard.updated",
  "dispatch.updated",
  "driver.location.updated",
  "driver.active-jobs.updated",
  "notification.created",
]);

export interface NotificationCreateSpec {
  tenantId: string;
  audience: NotificationAudience;
  userId?: string | null;
  role?: Role | null;
  type: string;
  title: string;
  description?: string | null;
  severity: NotificationSeverity;
  entityType?: string | null;
  entityId?: string | null;
  jobId?: string | null;
  tripId?: string | null;
  driverUserId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function shouldPersistNotificationFromRealtime(event: RealtimeEvent): boolean {
  if (SKIPPED_EVENT_TYPES.has(event.type)) {
    return false;
  }
  return PERSISTED_NOTIFICATION_EVENT_TYPES.has(event.type);
}

export function buildNotificationSpecsFromRealtimeEvent(
  event: RealtimeEvent,
): NotificationCreateSpec[] {
  if (!shouldPersistNotificationFromRealtime(event)) {
    return [];
  }

  const base = {
    tenantId: event.tenantId,
    type: event.type,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    jobId: event.jobId ?? null,
    tripId: event.tripId ?? null,
    driverUserId: event.driverUserId ?? null,
    metadata: buildNotificationMetadataFromEvent(event),
  };

  switch (event.type) {
    case "job.created":
      return [
        opsTenantSpec({
          ...base,
          title: "New job created",
          description: jobNotificationDescription(event),
          severity: NotificationSeverity.INFO,
        }),
      ];

    case "job.cancelled":
      return [
        opsTenantSpec({
          ...base,
          title: "Job cancelled",
          description: appendReason(jobNotificationDescription(event), event.reason),
          severity: NotificationSeverity.WARNING,
        }),
      ];

    case "trip.assigned":
    case "trip.unassigned":
    case "trip.published":
    case "trip.updated":
    case "trip.unpublished":
    case "trip.started":
    case "trip.completed":
    case "trip.done":
    case "trip.cancelled": {
      const specs: NotificationCreateSpec[] = [];
      const tripTitle = tripEventTitle(event.type);
      const tripDesc = tripNotificationDescription(event);

      if (event.driverUserId) {
        specs.push({
          ...base,
          audience: NotificationAudience.USER,
          userId: event.driverUserId,
          role: null,
          title: tripTitle.driver,
          description: tripDesc,
          severity: tripSeverity(event.type),
        });
      }

      specs.push(
        ...opsAdminAndOpsRoleSpecs({
          ...base,
          title: tripTitle.ops,
          description: tripDesc,
          severity: tripSeverity(event.type),
        }),
      );

      return specs;
    }

    case "document.uploaded":
    case "document.signed":
    case "document.deleted": {
      const specs: NotificationCreateSpec[] = [];
      const docTitle = documentEventTitle(event.type);

      if (event.driverUserId) {
        specs.push({
          ...base,
          audience: NotificationAudience.USER,
          userId: event.driverUserId,
          title: docTitle.driver,
          description: documentNotificationDescription(event),
          severity: NotificationSeverity.INFO,
        });
      }

      specs.push(
        ...opsAdminAndOpsRoleSpecs({
          ...base,
          title: docTitle.ops,
          description: documentNotificationDescription(event),
          severity: NotificationSeverity.INFO,
        }),
      );

      return specs;
    }

    case "driver.created":
    case "driver.updated":
    case "driver.deleted":
      return [
        opsTenantSpec({
          ...base,
          title: driverEventTitle(event.type),
          description: event.entityId ? `Driver ${event.entityId}` : null,
          severity:
            event.type === "driver.deleted"
              ? NotificationSeverity.WARNING
              : NotificationSeverity.INFO,
        }),
      ];

    case "vehicle.created":
    case "vehicle.updated":
    case "vehicle.deleted":
      return [
        opsRoleSpec(Role.OPS, {
          ...base,
          title: vehicleEventTitle(event.type),
          description: event.entityId ? `Vehicle ${event.entityId}` : null,
          severity:
            event.type === "vehicle.deleted"
              ? NotificationSeverity.WARNING
              : NotificationSeverity.INFO,
        }),
        opsRoleSpec(Role.ADMIN, {
          ...base,
          title: vehicleEventTitle(event.type),
          description: event.entityId ? `Vehicle ${event.entityId}` : null,
          severity:
            event.type === "vehicle.deleted"
              ? NotificationSeverity.WARNING
              : NotificationSeverity.INFO,
        }),
      ];

    case "invoice.generated":
      return [
        opsRoleSpec(Role.FINANCE, {
          ...base,
          title: "Invoice PDF generated",
          description: event.entityId ? `Invoice ${event.entityId}` : null,
          severity: NotificationSeverity.SUCCESS,
        }),
        opsRoleSpec(Role.ADMIN, {
          ...base,
          title: "Invoice PDF generated",
          description: event.entityId ? `Invoice ${event.entityId}` : null,
          severity: NotificationSeverity.SUCCESS,
        }),
      ];

    default:
      return [];
  }
}

function opsTenantSpec(
  partial: Omit<NotificationCreateSpec, "audience" | "userId" | "role">,
): NotificationCreateSpec {
  return {
    ...partial,
    audience: NotificationAudience.TENANT,
    userId: null,
    role: null,
  };
}

function opsRoleSpec(
  role: Role,
  partial: Omit<NotificationCreateSpec, "audience" | "userId" | "role">,
): NotificationCreateSpec {
  return {
    ...partial,
    audience: NotificationAudience.ROLE,
    userId: null,
    role,
  };
}

/** Ops trip/document noise: ADMIN + OPS only (not FINANCE tenant-wide). */
function opsAdminAndOpsRoleSpecs(
  partial: Omit<NotificationCreateSpec, "audience" | "userId" | "role">,
): NotificationCreateSpec[] {
  return [opsRoleSpec(Role.ADMIN, partial), opsRoleSpec(Role.OPS, partial)];
}

function tripEventTitle(type: string): { driver: string; ops: string } {
  const map: Record<string, { driver: string; ops: string }> = {
    "trip.assigned": { driver: "Trip assigned to you", ops: "Trip assigned" },
    "trip.unassigned": { driver: "Trip unassigned from you", ops: "Trip unassigned" },
    "trip.published": { driver: "Trip published", ops: "Trip published" },
    "trip.updated": { driver: "Trip updated", ops: "Trip updated" },
    "trip.unpublished": { driver: "Trip unpublished", ops: "Trip unpublished" },
    "trip.started": { driver: "Trip started", ops: "Trip started" },
    "trip.completed": { driver: "Trip completed", ops: "Trip completed" },
    "trip.done": { driver: "Trip marked done", ops: "Trip marked done" },
    "trip.cancelled": { driver: "Trip cancelled", ops: "Trip cancelled" },
  };
  return map[type] ?? { driver: "Trip update", ops: "Trip update" };
}

function tripSeverity(type: string): NotificationSeverity {
  if (type === "trip.cancelled") return NotificationSeverity.WARNING;
  if (type === "trip.completed" || type === "trip.done") {
    return NotificationSeverity.SUCCESS;
  }
  return NotificationSeverity.INFO;
}

function appendReason(text: string | null, reason?: string): string | null {
  const copy = reason?.trim() ? ` (${reason.trim()})` : "";
  if (!text && !copy) return null;
  return `${text ?? ""}${copy}`.trim() || null;
}

function documentEventTitle(type: string): { driver: string; ops: string } {
  const map: Record<string, { driver: string; ops: string }> = {
    "document.uploaded": {
      driver: "Document uploaded on your trip",
      ops: "Document uploaded",
    },
    "document.signed": {
      driver: "Document signed on your trip",
      ops: "Document signed",
    },
    "document.deleted": {
      driver: "Document removed on your trip",
      ops: "Document deleted",
    },
  };
  return map[type] ?? { driver: "Document update", ops: "Document update" };
}

function driverEventTitle(type: string): string {
  const map: Record<string, string> = {
    "driver.created": "Driver added",
    "driver.updated": "Driver updated",
    "driver.deleted": "Driver removed",
  };
  return map[type] ?? "Driver update";
}

function vehicleEventTitle(type: string): string {
  const map: Record<string, string> = {
    "vehicle.created": "Vehicle added",
    "vehicle.updated": "Vehicle updated",
    "vehicle.deleted": "Vehicle removed",
  };
  return map[type] ?? "Vehicle update";
}

export function dedupeKeyForSpec(spec: NotificationCreateSpec): string {
  const audienceKey =
    spec.audience === NotificationAudience.USER
      ? `user:${spec.userId ?? ""}`
      : spec.audience === NotificationAudience.ROLE
        ? `role:${spec.role ?? ""}`
        : "tenant";
  return [
    spec.tenantId,
    audienceKey,
    spec.type,
    spec.entityId ?? "",
    spec.entityType ?? "",
  ].join("|");
}

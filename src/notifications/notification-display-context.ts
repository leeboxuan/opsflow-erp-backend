import { MembershipStatus } from "@prisma/client";
import { buildTripDisplayRef } from "../common/trip-display-ref";
import type { RealtimeEvent } from "../realtime/realtime-event.types";

/** Uppercase kind for UI metadata (notification.type stays dotted, e.g. trip.assigned). */
export const NOTIFICATION_DISPLAY_TYPE: Record<string, string> = {
  "job.created": "JOB_CREATED",
  "job.cancelled": "JOB_CANCELLED",
  "trip.assigned": "TRIP_ASSIGNED",
  "trip.unassigned": "TRIP_UNASSIGNED",
  "trip.published": "TRIP_PUBLISHED",
  "trip.updated": "TRIP_UPDATED",
  "trip.unpublished": "TRIP_UNPUBLISHED",
  "trip.started": "TRIP_STARTED",
  "trip.completed": "TRIP_COMPLETED",
  "trip.done": "TRIP_DONE",
  "trip.cancelled": "TRIP_CANCELLED",
  "document.uploaded": "DOCUMENT_UPLOADED",
  "document.signed": "DOCUMENT_SIGNED",
  "document.deleted": "DOCUMENT_DELETED",
};

export type NotificationDisplayMetadata = Record<string, unknown>;

type EnrichmentPrisma = {
  job: {
    findFirst: (args: unknown) => Promise<{
      id: string;
      internalRef: string;
      customerCompany?: { name: string } | null;
    } | null>;
  };
  trip: {
    findFirst: (args: unknown) => Promise<{
      id: string;
      tripSequence: number | null;
      jobSequence: number | null;
      assignedDriverUserId: string | null;
      vehicleId: string | null;
      fleetVehicleId: string | null;
      job?: {
        id: string;
        internalRef: string;
        customerCompany?: { name: string } | null;
      } | null;
      vehicles?: { plateNo: string | null } | null;
      fleetVehicle?: { plateNo: string | null } | null;
    } | null>;
  };
  tenantMembership: {
    findMany: (args: unknown) => Promise<
      Array<{ userId: string; user?: { name: string | null; email: string | null } | null }>
    >;
  };
};

export async function enrichRealtimeEventForNotifications(
  prisma: unknown,
  event: RealtimeEvent,
): Promise<RealtimeEvent> {
  const db = prisma as EnrichmentPrisma;
  let enriched = { ...event };

  const needsJob =
    enriched.jobId &&
    (!enriched.jobInternalRef || !enriched.customerCompanyName);
  const needsTrip =
    enriched.tripId &&
    (!enriched.tripDisplayRef ||
      (enriched.type === "trip.assigned" &&
        (!enriched.assignedDriverName || !enriched.vehicleNumber)));

  if (needsTrip && enriched.tripId) {
    const trip = await db.trip.findFirst({
      where: { id: enriched.tripId, tenantId: enriched.tenantId },
      select: {
        id: true,
        tripSequence: true,
        jobSequence: true,
        assignedDriverUserId: true,
        vehicleId: true,
        fleetVehicleId: true,
        job: {
          select: {
            id: true,
            internalRef: true,
            customerCompany: { select: { name: true } },
          },
        },
        vehicles: { select: { plateNo: true } },
        fleetVehicle: { select: { plateNo: true } },
      },
    });

    if (trip) {
      enriched = {
        ...enriched,
        jobId: enriched.jobId ?? trip.job?.id ?? enriched.jobId,
        jobInternalRef:
          enriched.jobInternalRef ?? trip.job?.internalRef ?? undefined,
        customerCompanyName:
          enriched.customerCompanyName ??
          trip.job?.customerCompany?.name ??
          undefined,
        tripDisplayRef:
          enriched.tripDisplayRef ??
          buildTripDisplayRef({
            jobInternalRef: trip.job?.internalRef ?? null,
            tripSequence: trip.tripSequence,
            jobSequence: trip.jobSequence,
            tripId: trip.id,
          }),
        vehicleNumber:
          enriched.vehicleNumber ??
          trip.fleetVehicle?.plateNo ??
          trip.vehicles?.plateNo ??
          undefined,
        driverUserId:
          enriched.driverUserId ??
          trip.assignedDriverUserId ??
          undefined,
      };

      if (
        !enriched.assignedDriverName &&
        trip.assignedDriverUserId
      ) {
        const nameMap = await buildDriverNameMap(db, enriched.tenantId, [
          trip.assignedDriverUserId,
        ]);
        enriched.assignedDriverName =
          nameMap.get(trip.assignedDriverUserId) ?? undefined;
      }
    }
  } else if (needsJob && enriched.jobId) {
    const job = await db.job.findFirst({
      where: { id: enriched.jobId, tenantId: enriched.tenantId },
      select: {
        id: true,
        internalRef: true,
        customerCompany: { select: { name: true } },
      },
    });
    if (job) {
      enriched = {
        ...enriched,
        jobInternalRef: enriched.jobInternalRef ?? job.internalRef,
        customerCompanyName:
          enriched.customerCompanyName ?? job.customerCompany?.name ?? undefined,
      };
    }
  }

  return enriched;
}

async function buildDriverNameMap(
  prisma: EnrichmentPrisma,
  tenantId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();

  const members = await prisma.tenantMembership.findMany({
    where: { tenantId, userId: { in: ids }, status: MembershipStatus.Active },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  const map = new Map<string, string>();
  for (const m of members) {
    const label = m.user?.name?.trim() || m.user?.email?.trim();
    if (label) map.set(m.userId, label);
  }
  return map;
}

export function buildNotificationMetadataFromEvent(
  event: RealtimeEvent,
): NotificationDisplayMetadata | null {
  const displayType = NOTIFICATION_DISPLAY_TYPE[event.type];
  const meta: NotificationDisplayMetadata = {};

  if (displayType) meta.displayType = displayType;
  if (event.reason) meta.reason = event.reason;

  if (event.jobId) meta.jobId = event.jobId;
  if (event.jobInternalRef) meta.jobInternalRef = event.jobInternalRef;
  if (event.customerCompanyName) {
    meta.customerCompanyName = event.customerCompanyName;
  }

  if (event.tripId) meta.tripId = event.tripId;
  if (event.tripDisplayRef) meta.tripDisplayRef = event.tripDisplayRef;

  const driverUserId = event.driverUserId;
  if (driverUserId) meta.assignedDriverUserId = driverUserId;
  if (event.assignedDriverName) {
    meta.assignedDriverName = event.assignedDriverName;
  }
  if (event.vehicleNumber) meta.vehicleNumber = event.vehicleNumber;

  return Object.keys(meta).length ? meta : null;
}

export function jobNotificationDescription(event: RealtimeEvent): string | null {
  const ref = event.jobInternalRef?.trim();
  const customer = event.customerCompanyName?.trim();
  if (customer && ref) return `${customer} · ${ref}`;
  if (ref) return ref;
  if (customer) return customer;
  return event.jobId ? `Job ${event.jobId}` : null;
}

export function tripNotificationDescription(event: RealtimeEvent): string | null {
  const tripRef = event.tripDisplayRef?.trim();
  const jobRef = event.jobInternalRef?.trim();
  const parts = [tripRef, jobRef].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  const fallback = [
    event.tripId ? `Trip ${event.tripId}` : null,
    event.jobId ? `Job ${event.jobId}` : null,
  ].filter(Boolean);
  return fallback.length ? fallback.join(" · ") : null;
}

export function documentNotificationDescription(
  event: RealtimeEvent,
): string | null {
  return tripNotificationDescription(event);
}

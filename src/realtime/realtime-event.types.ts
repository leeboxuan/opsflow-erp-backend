export const REALTIME_ENTITY_TYPES = [
  "job",
  "trip",
  "document",
  "driver",
  "vehicle",
  "customer",
  "dispatch",
  "dashboard",
  "notification",
] as const;

export type RealtimeEntityType = (typeof REALTIME_ENTITY_TYPES)[number];

export interface RealtimeNotificationContext {
  /** Human-readable job ref, e.g. WFL-2026-05-0010-LCL */
  jobInternalRef?: string;
  customerCompanyName?: string;
  /** Human-readable trip ref, e.g. WFL-0010-LCL-T01 */
  tripDisplayRef?: string;
  assignedDriverName?: string;
  /** Vehicle plate / number shown in UI */
  vehicleNumber?: string;
}

export interface RealtimeEvent extends RealtimeNotificationContext {
  type: string;
  tenantId: string;
  entityType: RealtimeEntityType;
  entityId?: string;
  jobId?: string;
  tripId?: string;
  driverUserId?: string;
  changedAt: string;
  reason?: string;
}

export type RealtimeEventInput = Omit<RealtimeEvent, "changedAt"> & {
  changedAt?: string;
};

export interface RealtimeSubscriberContext {
  tenantId: string;
  role: import("@prisma/client").Role;
  userId: string;
}

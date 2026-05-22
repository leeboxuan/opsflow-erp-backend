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

export interface RealtimeEvent {
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

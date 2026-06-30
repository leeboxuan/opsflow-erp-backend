export const REALTIME_ENTITY_TYPES = [
  "job",
  "trip",
  "document",
  "driver",
  "vehicle",
  "asset",
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
  /** User who performed the action (for notification audience rules). */
  actorUserId?: string;
  actorRole?: import("@prisma/client").Role;
  tripStatus?: import("@prisma/client").TripStatus;
  /** UI notification kind for driver copy/metadata. */
  notificationKind?: string;
  documentTypeLabel?: string;
  earningsAmountCents?: number;
  assetType?: "CHASSIS";
  chassisId?: string | null;
  gpsDeviceId?: string;
  terminalId?: string;
  vehicleId?: string | null;
  speedKph?: number | null;
  heading?: number | null;
  altitude?: number | null;
  lat?: number;
  lng?: number;
  recordedAt?: string;
  receivedAt?: string;
  status?: "LIVE";
  source?: "GPS_TRACKER";
}

export type RealtimeEventInput = Omit<RealtimeEvent, "changedAt"> & {
  changedAt?: string;
};

export interface RealtimeSubscriberContext {
  tenantId: string;
  role: import("@prisma/client").Role;
  userId: string;
}

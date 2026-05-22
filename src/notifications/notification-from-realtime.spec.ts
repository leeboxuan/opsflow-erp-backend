import { NotificationAudience, Role } from "@prisma/client";
import {
  buildNotificationSpecsFromRealtimeEvent,
  shouldPersistNotificationFromRealtime,
} from "./notification-from-realtime";
import type { RealtimeEvent } from "../realtime/realtime-event.types";

function event(partial: Partial<RealtimeEvent>): RealtimeEvent {
  return {
    type: "trip.assigned",
    tenantId: "tenant-1",
    entityType: "trip",
    changedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("notification-from-realtime", () => {
  it("does not persist heartbeat, dispatch, dashboard, or location noise", () => {
    for (const type of [
      "heartbeat",
      "dispatch.updated",
      "dashboard.updated",
      "driver.location.updated",
      "driver.active-jobs.updated",
    ]) {
      expect(
        shouldPersistNotificationFromRealtime(event({ type })),
      ).toBe(false);
    }
  });

  it("persists trip.assigned with driver USER + admin/ops ROLE", () => {
    const specs = buildNotificationSpecsFromRealtimeEvent(
      event({
        type: "trip.assigned",
        driverUserId: "drv-1",
        tripId: "trip-1",
        jobId: "job-1",
      }),
    );
    expect(specs).toHaveLength(3);
    expect(specs[0]).toMatchObject({
      audience: NotificationAudience.USER,
      userId: "drv-1",
    });
    expect(specs[1].role).toBe(Role.ADMIN);
    expect(specs[2].role).toBe(Role.OPS);
    expect(specs.every((s) => s.audience !== NotificationAudience.TENANT)).toBe(
      true,
    );
  });

  it("invoice.generated targets FINANCE and ADMIN roles", () => {
    const specs = buildNotificationSpecsFromRealtimeEvent(
      event({
        type: "invoice.generated",
        entityType: "dashboard",
        entityId: "inv-1",
      }),
    );
    expect(specs.map((s) => s.role).sort()).toEqual(
      [Role.ADMIN, Role.FINANCE].sort(),
    );
  });
});

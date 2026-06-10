import { NotificationAudience, Role, TripStatus } from "@prisma/client";
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

  it("does not notify driver when driver uploads document", () => {
    const specs = buildNotificationSpecsFromRealtimeEvent(
      event({
        type: "document.uploaded",
        entityType: "document",
        entityId: "doc-1",
        tripId: "trip-1",
        jobId: "job-1",
        driverUserId: "drv-1",
        actorUserId: "drv-1",
        actorRole: Role.DRIVER,
        tripStatus: TripStatus.PUBLISHED,
      }),
    );
    const driverSpecs = specs.filter(
      (s) => s.audience === NotificationAudience.USER,
    );
    expect(driverSpecs).toHaveLength(0);
    expect(specs.some((s) => s.role === Role.OPS)).toBe(true);
  });

  it("notifies assigned driver when ops uploads trip document", () => {
    const specs = buildNotificationSpecsFromRealtimeEvent(
      event({
        type: "document.uploaded",
        entityType: "document",
        entityId: "doc-1",
        tripId: "trip-1",
        jobId: "job-1",
        jobInternalRef: "WFL-2026-06-0001-LCL",
        tripDisplayRef: "TRIP-T01",
        driverUserId: "drv-1",
        actorUserId: "ops-1",
        actorRole: Role.OPS,
        tripStatus: TripStatus.PUBLISHED,
        notificationKind: "DOCUMENT_ADDED",
        documentTypeLabel: "Delivery DO",
      }),
    );
    const driverSpec = specs.find(
      (s) => s.audience === NotificationAudience.USER && s.userId === "drv-1",
    );
    expect(driverSpec).toMatchObject({
      title: "Document added",
      description: "WFL-2026-06-0001-LCL · TRIP-T01 Delivery DO was added.",
    });
    expect(driverSpec?.metadata).toMatchObject({
      jobId: "job-1",
      tripId: "trip-1",
      jobInternalRef: "WFL-2026-06-0001-LCL",
      tripDisplayRef: "TRIP-T01",
      type: "DOCUMENT_ADDED",
    });
  });

  it("notifies driver once for admin trip notes update", () => {
    const specs = buildNotificationSpecsFromRealtimeEvent(
      event({
        type: "trip.updated",
        entityType: "trip",
        entityId: "trip-1",
        tripId: "trip-1",
        jobId: "job-1",
        jobInternalRef: "WFL-2026-06-0004-COL",
        tripDisplayRef: "TRIP-T01",
        driverUserId: "drv-1",
        actorUserId: "ops-1",
        actorRole: Role.OPS,
        tripStatus: TripStatus.PUBLISHED,
        notificationKind: "TRIP_NOTES_UPDATED",
      }),
    );
    const driverSpecs = specs.filter(
      (s) => s.audience === NotificationAudience.USER,
    );
    expect(driverSpecs).toHaveLength(1);
    expect(driverSpecs[0]).toMatchObject({
      title: "Trip notes updated",
      description: "WFL-2026-06-0004-COL · TRIP-T01 notes were updated.",
    });
  });

  it("notifies driver once for admin trip details update with instructions copy", () => {
    const specs = buildNotificationSpecsFromRealtimeEvent(
      event({
        type: "trip.updated",
        entityType: "trip",
        entityId: "trip-1",
        tripId: "trip-1",
        jobId: "job-1",
        jobInternalRef: "WFL-2026-06-0001-LCL",
        tripDisplayRef: "TRIP-T01",
        driverUserId: "drv-1",
        actorUserId: "ops-1",
        actorRole: Role.OPS,
        tripStatus: TripStatus.PUBLISHED,
        notificationKind: "TRIP_INSTRUCTIONS_UPDATED",
      }),
    );
    const driverSpecs = specs.filter(
      (s) => s.audience === NotificationAudience.USER,
    );
    expect(driverSpecs).toHaveLength(1);
    expect(driverSpecs[0]).toMatchObject({
      title: "Trip instructions updated",
      description: "WFL-2026-06-0001-LCL · TRIP-T01 instructions were updated.",
    });
  });

  it("does not notify driver when driver completes trip", () => {
    const specs = buildNotificationSpecsFromRealtimeEvent(
      event({
        type: "trip.completed",
        entityType: "trip",
        entityId: "trip-1",
        tripId: "trip-1",
        jobId: "job-1",
        driverUserId: "drv-1",
        actorUserId: "drv-1",
        actorRole: Role.DRIVER,
        tripStatus: TripStatus.COMPLETED,
      }),
    );
    expect(
      specs.filter((s) => s.audience === NotificationAudience.USER),
    ).toHaveLength(0);
  });

  it("notifies driver of earnings update from admin", () => {
    const specs = buildNotificationSpecsFromRealtimeEvent(
      event({
        type: "trip.updated",
        entityType: "trip",
        entityId: "trip-1",
        tripId: "trip-1",
        jobId: "job-1",
        jobInternalRef: "WFL-2026-06-0001-LCL",
        tripDisplayRef: "TRIP-T01",
        driverUserId: "drv-1",
        actorUserId: "ops-1",
        actorRole: Role.OPS,
        tripStatus: TripStatus.PUBLISHED,
        notificationKind: "EARNINGS_UPDATED",
        earningsAmountCents: 2800,
      }),
    );
    const driverSpec = specs.find((s) => s.userId === "drv-1");
    expect(driverSpec?.title).toBe("Earnings updated");
    expect(driverSpec?.description).toContain("SGD 28.00");
    expect(driverSpec?.metadata?.type).toBe("EARNINGS_UPDATED");
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

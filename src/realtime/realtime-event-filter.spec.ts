import { Role } from "@prisma/client";
import { shouldDeliverRealtimeEvent } from "./realtime-event-filter";
import type { RealtimeEvent } from "./realtime-event.types";

function event(partial: Partial<RealtimeEvent>): RealtimeEvent {
  return {
    type: "trip.updated",
    tenantId: "tenant-1",
    entityType: "trip",
    changedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("shouldDeliverRealtimeEvent", () => {
  const ops = { tenantId: "tenant-1", role: Role.OPS, userId: "ops-1" };
  const driver = { tenantId: "tenant-1", role: Role.DRIVER, userId: "drv-1" };
  const customer = { tenantId: "tenant-1", role: Role.CUSTOMER, userId: "cust-1" };

  it("delivers tenant ops events to ADMIN/OPS/FINANCE", () => {
    expect(
      shouldDeliverRealtimeEvent(
        event({ type: "job.updated", entityType: "job" }),
        { ...ops, role: Role.ADMIN },
      ),
    ).toBe(true);
    expect(
      shouldDeliverRealtimeEvent(
        event({ type: "dispatch.updated", entityType: "dispatch" }),
        { ...ops, role: Role.FINANCE },
      ),
    ).toBe(true);
  });

  it("blocks CUSTOMER from internal events", () => {
    expect(
      shouldDeliverRealtimeEvent(
        event({ type: "job.updated", entityType: "job" }),
        customer,
      ),
    ).toBe(false);
  });

  it("blocks cross-tenant delivery", () => {
    expect(
      shouldDeliverRealtimeEvent(
        event({ tenantId: "tenant-2" }),
        ops,
      ),
    ).toBe(false);
  });

  it("delivers driver trip events only when driverUserId matches", () => {
    expect(
      shouldDeliverRealtimeEvent(
        event({ type: "trip.assigned", driverUserId: "drv-1" }),
        driver,
      ),
    ).toBe(true);
    expect(
      shouldDeliverRealtimeEvent(
        event({ type: "trip.assigned", driverUserId: "drv-2" }),
        driver,
      ),
    ).toBe(false);
  });

  it("delivers driver document events for assigned driver", () => {
    expect(
      shouldDeliverRealtimeEvent(
        event({
          type: "document.signed",
          entityType: "document",
          driverUserId: "drv-1",
        }),
        driver,
      ),
    ).toBe(true);
  });

  it("blocks dashboard.updated for drivers", () => {
    expect(
      shouldDeliverRealtimeEvent(
        event({ type: "dashboard.updated", entityType: "dashboard" }),
        driver,
      ),
    ).toBe(false);
  });

  it("delivers dispatch.updated to driver only when tagged with their id", () => {
    expect(
      shouldDeliverRealtimeEvent(
        event({ type: "dispatch.updated", entityType: "dispatch", driverUserId: "drv-1" }),
        driver,
      ),
    ).toBe(true);
    expect(
      shouldDeliverRealtimeEvent(
        event({ type: "dispatch.updated", entityType: "dispatch" }),
        driver,
      ),
    ).toBe(false);
  });

  it("uses subscriber userId (app user id) for driver matching", () => {
    expect(
      shouldDeliverRealtimeEvent(
        event({
          type: "trip.started",
          driverUserId: "internal-user-cuid",
        }),
        { ...driver, userId: "internal-user-cuid" },
      ),
    ).toBe(true);
    expect(
      shouldDeliverRealtimeEvent(
        event({
          type: "trip.started",
          driverUserId: "internal-user-cuid",
        }),
        { ...driver, userId: "different-user" },
      ),
    ).toBe(false);
  });

  it("delivers notification.created to driver only when driverUserId matches", () => {
    expect(
      shouldDeliverRealtimeEvent(
        event({
          type: "notification.created",
          entityType: "notification",
          entityId: "n-1",
          driverUserId: "drv-1",
        }),
        driver,
      ),
    ).toBe(true);
    expect(
      shouldDeliverRealtimeEvent(
        event({
          type: "notification.created",
          entityType: "notification",
          driverUserId: "drv-2",
        }),
        driver,
      ),
    ).toBe(false);
    expect(
      shouldDeliverRealtimeEvent(
        event({ type: "notification.created", entityType: "notification" }),
        { ...ops, role: Role.FINANCE },
      ),
    ).toBe(true);
  });

  it("delivers driver.active-jobs.updated to matching driver", () => {
    expect(
      shouldDeliverRealtimeEvent(
        event({
          type: "driver.active-jobs.updated",
          entityType: "driver",
          driverUserId: "drv-1",
        }),
        driver,
      ),
    ).toBe(true);
  });
});

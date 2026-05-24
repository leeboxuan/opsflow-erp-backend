import {
  buildNotificationMetadataFromEvent,
  jobNotificationDescription,
  tripNotificationDescription,
} from "./notification-display-context";
import type { RealtimeEvent } from "../realtime/realtime-event.types";
import { buildNotificationSpecsFromRealtimeEvent } from "./notification-from-realtime";

describe("notification-display-context", () => {
  const tripEvent: RealtimeEvent = {
    type: "trip.assigned",
    tenantId: "tenant-1",
    entityType: "trip",
    entityId: "trip-cuid",
    jobId: "job-cuid",
    tripId: "trip-cuid",
    driverUserId: "drv-1",
    changedAt: new Date().toISOString(),
    jobInternalRef: "WF-2026-05-0010-LCL",
    tripDisplayRef: "WF-0010-LCL-T01",
    assignedDriverName: "Test Driver Nat",
    vehicleNumber: "XMM123",
  };

  it("builds trip metadata with display refs", () => {
    expect(buildNotificationMetadataFromEvent(tripEvent)).toMatchObject({
      displayType: "TRIP_ASSIGNED",
      tripId: "trip-cuid",
      tripDisplayRef: "WF-0010-LCL-T01",
      jobId: "job-cuid",
      jobInternalRef: "WF-2026-05-0010-LCL",
      assignedDriverUserId: "drv-1",
      assignedDriverName: "Test Driver Nat",
      vehicleNumber: "XMM123",
    });
  });

  it("uses friendly trip description instead of raw ids", () => {
    expect(tripNotificationDescription(tripEvent)).toBe(
      "WF-0010-LCL-T01 · WF-2026-05-0010-LCL",
    );
  });

  it("uses customer and job ref for job.created", () => {
    const jobEvent: RealtimeEvent = {
      type: "job.created",
      tenantId: "tenant-1",
      entityType: "job",
      entityId: "job-cuid",
      jobId: "job-cuid",
      changedAt: new Date().toISOString(),
      jobInternalRef: "WF-2026-05-0010-LCL",
      customerCompanyName: "ACME Logistics",
    };
    expect(jobNotificationDescription(jobEvent)).toBe(
      "ACME Logistics · WF-2026-05-0010-LCL",
    );
  });

  it("persists metadata on notification specs", () => {
    const specs = buildNotificationSpecsFromRealtimeEvent(tripEvent);
    expect(specs[0].metadata).toMatchObject({
      tripDisplayRef: "WF-0010-LCL-T01",
      jobInternalRef: "WF-2026-05-0010-LCL",
    });
    expect(specs[0].description).toBe("WF-0010-LCL-T01 · WF-2026-05-0010-LCL");
  });
});

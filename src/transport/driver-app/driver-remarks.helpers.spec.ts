import {
  DRIVER_REMARKS_NOTIFICATION_KIND,
  auditLogHasDriverRemarksChange,
  buildDriverRemarksAuditMetadata,
  driverRemarksChanged,
  labelForOperationalDetailsActivity,
  normalizeDriverRemarksText,
  opsCopyForDriverRemarksNotification,
} from "./driver-remarks.helpers";

describe("driver-remarks.helpers", () => {
  it("normalizes empty remarks to null", () => {
    expect(normalizeDriverRemarksText("  ")).toBeNull();
    expect(normalizeDriverRemarksText("Gate delay")).toBe("Gate delay");
  });

  it("detects create and update changes without erasing history metadata", () => {
    expect(driverRemarksChanged(null, "First")).toBe(true);
    expect(driverRemarksChanged("First", "First")).toBe(false);
    expect(driverRemarksChanged("First", "Second")).toBe(true);

    const first = buildDriverRemarksAuditMetadata({
      jobId: "job-1",
      previousDriverRemarks: null,
      driverRemarks: "First",
      changedFields: ["driverRemarks"],
      updatedAtIso: "2026-08-21T01:00:00.000Z",
      actorUserId: "drv-1",
    });
    const second = buildDriverRemarksAuditMetadata({
      jobId: "job-1",
      previousDriverRemarks: "First",
      driverRemarks: "Second",
      changedFields: ["driverRemarks"],
      updatedAtIso: "2026-08-21T02:00:00.000Z",
      actorUserId: "drv-1",
    });

    expect(first.previousDriverRemarks).toBeNull();
    expect(first.driverRemarks).toBe("First");
    expect(second.previousDriverRemarks).toBe("First");
    expect(second.driverRemarks).toBe("Second");
    expect(auditLogHasDriverRemarksChange(first)).toBe(true);
    expect(auditLogHasDriverRemarksChange(second)).toBe(true);
  });

  it("labels activity rows for remarks and container updates", () => {
    expect(
      labelForOperationalDetailsActivity({ changedFields: ["driverRemarks"] }),
    ).toBe("Driver remarks updated");
    expect(
      labelForOperationalDetailsActivity({
        changedFields: ["driverRemarks", "containerNumber"],
      }),
    ).toBe("Driver remarks and container details updated");
    expect(
      labelForOperationalDetailsActivity({ changedFields: ["sealNumber"] }),
    ).toBe("Container details updated");
  });

  it("builds ops notification copy for DRIVER_REMARKS_UPDATED", () => {
    expect(DRIVER_REMARKS_NOTIFICATION_KIND).toBe("DRIVER_REMARKS_UPDATED");
    expect(opsCopyForDriverRemarksNotification("JOB-1 · TRIP-T01")).toEqual({
      title: "Driver remark updated",
      description: "JOB-1 · TRIP-T01 — driver sent a remark to Operations.",
    });
  });
});

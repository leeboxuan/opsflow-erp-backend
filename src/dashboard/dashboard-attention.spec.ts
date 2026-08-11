import {
  buildAttentionItemId,
  buildDashboardAttention,
  buildOverdueActiveTripItem,
  buildOverdueActiveTripWhere,
  buildReadyNotInvoicedItem,
  buildUnassignedStartingSoonItem,
  buildUnassignedStartingSoonWhere,
  compareAttentionItems,
  DASHBOARD_ATTENTION_ITEM_LIMIT,
  mergeAttentionItems,
} from "./dashboard-attention";

describe("dashboard attention helpers", () => {
  const now = new Date("2026-08-11T12:00:00.000Z");

  it("builds deterministic ids per type and entity", () => {
    expect(buildAttentionItemId("unassigned_starting_soon", "t1")).toBe(
      "unassigned_starting_soon:t1",
    );
    expect(buildAttentionItemId("overdue_active_trip", "t1")).toBe(
      "overdue_active_trip:t1",
    );
    expect(buildAttentionItemId("ready_not_invoiced", "j1")).toBe(
      "ready_not_invoiced:j1",
    );
  });

  it("unassigned where includes DRAFT/PUBLISHED window and excludes driver assignment", () => {
    const where = buildUnassignedStartingSoonWhere("tenant-a", now);
    expect(where).toEqual({
      tenantId: "tenant-a",
      jobId: { not: null },
      status: { in: ["DRAFT", "PUBLISHED"] },
      plannedStartAt: {
        gte: now,
        lt: new Date("2026-08-12T12:00:00.000Z"),
      },
      assignedDriverUserId: null,
      driverId: null,
    });
  });

  it("overdue where requires plannedEndAt before now and active statuses only", () => {
    expect(buildOverdueActiveTripWhere("tenant-a", now)).toEqual({
      tenantId: "tenant-a",
      jobId: { not: null },
      status: { in: ["PUBLISHED", "ONGOING"] },
      plannedEndAt: { not: null, lt: now },
    });
  });

  it("item builders emit required titles, reasons, hrefs, and timestamps", () => {
    const start = new Date("2026-08-11T15:00:00.000Z");
    const end = new Date("2026-08-10T10:00:00.000Z");
    const readyAt = new Date("2026-08-01T08:00:00.000Z");
    const updatedAt = new Date("2026-08-02T08:00:00.000Z");

    expect(
      buildUnassignedStartingSoonItem({
        id: "trip-1",
        jobId: "job-1",
        plannedStartAt: start,
      }),
    ).toMatchObject({
      id: "unassigned_starting_soon:trip-1",
      severity: "critical",
      entityType: "TRIP",
      title: "Unassigned trip starting soon",
      dueAt: start.toISOString(),
      href: "/jobs/job-1/workspace?tripId=trip-1",
    });

    expect(
      buildOverdueActiveTripItem({
        id: "trip-2",
        jobId: "job-2",
        plannedEndAt: end,
      }),
    ).toMatchObject({
      id: "overdue_active_trip:trip-2",
      severity: "critical",
      dueAt: end.toISOString(),
      href: "/jobs/job-2/workspace?tripId=trip-2",
    });

    expect(
      buildReadyNotInvoicedItem({
        id: "job-3",
        invoiceReadyAt: readyAt,
        updatedAt,
      }),
    ).toMatchObject({
      id: "ready_not_invoiced:job-3",
      severity: "warning",
      entityType: "JOB",
      occurredAt: readyAt.toISOString(),
      dueAt: null,
      href: "/invoices/create?jobId=job-3",
    });

    expect(
      buildReadyNotInvoicedItem({
        id: "job-4",
        invoiceReadyAt: null,
        updatedAt,
      }).occurredAt,
    ).toBe(updatedAt.toISOString());
  });

  it("sorts critical before warning, overdue before unassigned, then earliest due", () => {
    const warning = buildReadyNotInvoicedItem({
      id: "job-old",
      invoiceReadyAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const overdueLater = buildOverdueActiveTripItem({
      id: "trip-overdue-b",
      jobId: "job-b",
      plannedEndAt: new Date("2026-08-10T12:00:00.000Z"),
    });
    const overdueEarlier = buildOverdueActiveTripItem({
      id: "trip-overdue-a",
      jobId: "job-a",
      plannedEndAt: new Date("2026-08-09T12:00:00.000Z"),
    });
    const unassigned = buildUnassignedStartingSoonItem({
      id: "trip-soon",
      jobId: "job-c",
      plannedStartAt: new Date("2026-08-11T13:00:00.000Z"),
    });

    const ordered = mergeAttentionItems([
      [warning, unassigned, overdueLater, overdueEarlier],
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      "overdue_active_trip:trip-overdue-a",
      "overdue_active_trip:trip-overdue-b",
      "unassigned_starting_soon:trip-soon",
      "ready_not_invoiced:job-old",
    ]);
    expect(compareAttentionItems(overdueEarlier, overdueLater)).toBeLessThan(0);
  });

  it("unassigned window is half-open [now, now+24h)", () => {
    const where = buildUnassignedStartingSoonWhere(
      "tenant-a",
      new Date("2026-08-11T12:00:00.000Z"),
    );
    expect(where.plannedStartAt.gte.toISOString()).toBe(
      "2026-08-11T12:00:00.000Z",
    );
    expect(where.plannedStartAt.lt.toISOString()).toBe(
      "2026-08-12T12:00:00.000Z",
    );
  });

  it("overdue requires plannedEndAt strictly before now", () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    const where = buildOverdueActiveTripWhere("tenant-a", now);
    expect(where.plannedEndAt).toEqual({ not: null, lt: now });
  });

  it("caps merged items while preserving exact counts in buildDashboardAttention", () => {
    const overdueItems = Array.from({ length: 20 }, (_, index) =>
      buildOverdueActiveTripItem({
        id: `trip-o-${String(index).padStart(2, "0")}`,
        jobId: `job-o-${index}`,
        plannedEndAt: new Date(Date.UTC(2026, 7, 1 + index, 0, 0, 0)),
      }),
    );
    const unassignedItems = Array.from({ length: 20 }, (_, index) =>
      buildUnassignedStartingSoonItem({
        id: `trip-u-${String(index).padStart(2, "0")}`,
        jobId: `job-u-${index}`,
        plannedStartAt: new Date(Date.UTC(2026, 7, 11, 12 + (index % 10), 0, 0)),
      }),
    );
    const readyItems = Array.from({ length: 10 }, (_, index) =>
      buildReadyNotInvoicedItem({
        id: `job-r-${index}`,
        invoiceReadyAt: new Date(Date.UTC(2026, 6, 1 + index, 0, 0, 0)),
        updatedAt: new Date(Date.UTC(2026, 6, 15, 0, 0, 0)),
      }),
    );

    const attention = buildDashboardAttention({
      unassignedCount: 40,
      overdueCount: 30,
      readyNotInvoicedCount: 12,
      unassignedItems,
      overdueItems,
      readyNotInvoicedItems: readyItems,
      limit: DASHBOARD_ATTENTION_ITEM_LIMIT,
    });

    expect(attention.total).toBe(82);
    expect(attention.counts).toEqual({
      critical: 70,
      warning: 12,
      info: 0,
    });
    expect(attention.items).toHaveLength(25);
    expect(attention.items.every((item) => item.severity === "critical")).toBe(
      true,
    );
    expect(attention.items[0].type).toBe("overdue_active_trip");
  });

  it("allows the same entity id under different attention types", () => {
    const tripId = "shared-trip";
    const unassigned = buildUnassignedStartingSoonItem({
      id: tripId,
      jobId: "job-1",
      plannedStartAt: now,
    });
    const overdue = buildOverdueActiveTripItem({
      id: tripId,
      jobId: "job-1",
      plannedEndAt: new Date("2026-08-10T00:00:00.000Z"),
    });
    expect(unassigned.id).not.toBe(overdue.id);
    expect(mergeAttentionItems([[unassigned, overdue]]).map((i) => i.id)).toEqual([
      "overdue_active_trip:shared-trip",
      "unassigned_starting_soon:shared-trip",
    ]);
  });
});

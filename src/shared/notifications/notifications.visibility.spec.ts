import { NotificationAudience, Role } from "@prisma/client";
import {
  buildNotificationVisibilityWhere,
  canViewerAccessNotification,
  assertNotificationViewerAllowed,
} from "./notifications.visibility";

describe("notifications.visibility", () => {
  it("blocks CUSTOMER from listing", () => {
    expect(() =>
      assertNotificationViewerAllowed(Role.CUSTOMER),
    ).toThrow(/not available for customer/i);
  });

  it("transport staff sees USER, ROLE OPS/TRANSPORT_STAFF, and TENANT", () => {
    const where = buildNotificationVisibilityWhere({
      tenantId: "t1",
      userId: "ops-1",
      role: Role.TRANSPORT_STAFF,
    });
    expect(where).toEqual({
      tenantId: "t1",
      OR: [
        { audience: NotificationAudience.USER, userId: "ops-1" },
        {
          audience: NotificationAudience.ROLE,
          role: { in: [Role.TRANSPORT_STAFF, Role.OPS] },
        },
        { audience: NotificationAudience.TENANT },
      ],
    });
  });

  it("DRIVER sees only own USER and DRIVER ROLE", () => {
    const where = buildNotificationVisibilityWhere({
      tenantId: "t1",
      userId: "drv-1",
      role: Role.DRIVER,
    });
    expect(where.OR).toEqual([
      { audience: NotificationAudience.USER, userId: "drv-1" },
      { audience: NotificationAudience.ROLE, role: Role.DRIVER },
    ]);
    expect(where.OR).not.toContainEqual({ audience: NotificationAudience.TENANT });
  });

  it("driver cannot access another driver's USER notification", () => {
    expect(
      canViewerAccessNotification(
        { tenantId: "t1", userId: "drv-1", role: Role.DRIVER },
        {
          tenantId: "t1",
          audience: NotificationAudience.USER,
          userId: "drv-2",
          role: null,
        },
      ),
    ).toBe(false);
  });

  it("driver can access own USER notification", () => {
    expect(
      canViewerAccessNotification(
        { tenantId: "t1", userId: "drv-1", role: Role.DRIVER },
        {
          tenantId: "t1",
          audience: NotificationAudience.USER,
          userId: "drv-1",
          role: null,
        },
      ),
    ).toBe(true);
  });
});

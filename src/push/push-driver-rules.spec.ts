import { NotificationAudience } from "@prisma/client";
import {
  DRIVER_PUSH_NOTIFICATION_TYPES,
  shouldSendDriverPushForNotification,
} from "./push-driver-rules";

describe("push-driver-rules", () => {
  it("allows driver USER trip and document types", () => {
    for (const type of DRIVER_PUSH_NOTIFICATION_TYPES) {
      expect(
        shouldSendDriverPushForNotification({
          audience: NotificationAudience.USER,
          userId: "drv-1",
          type,
        }),
      ).toBe(true);
    }
  });

  it("rejects TENANT and ROLE audiences", () => {
    expect(
      shouldSendDriverPushForNotification({
        audience: NotificationAudience.TENANT,
        userId: "ops-1",
        type: "job.created",
      }),
    ).toBe(false);
  });

  it("rejects dispatch/dashboard style types", () => {
    expect(
      shouldSendDriverPushForNotification({
        audience: NotificationAudience.USER,
        userId: "drv-1",
        type: "dispatch.updated",
      }),
    ).toBe(false);
  });
});

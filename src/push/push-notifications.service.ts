import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NotificationAudience } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  defaultExpoSend,
  type ExpoPushMessage,
  type ExpoPushSendFn,
  sendExpoPushMessages,
} from "./expo-push.client";
import { driverPushCopyForType } from "./push-driver-copy";
import { shouldSendDriverPushForNotification } from "./push-driver-rules";

export interface CreatedNotificationPushInput {
  id: string;
  tenantId: string;
  userId: string | null;
  audience: NotificationAudience;
  type: string;
  jobId: string | null;
  tripId: string | null;
}

@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.enabled = configService.get<string>("EXPO_PUSH_ENABLED") !== "false";
  }

  /**
   * Fire-and-forget entry: never throws to callers.
   */
  sendForCreatedNotification(input: CreatedNotificationPushInput): void {
    void this.deliverDriverPush(input).catch((err) => {
      this.logger.warn(
        `Driver push failed for notification ${input.id}: ${(err as Error).message}`,
      );
    });
  }

  /** @internal */
  async deliverDriverPush(
    input: CreatedNotificationPushInput,
    sendFn?: ExpoPushSendFn,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (
      !shouldSendDriverPushForNotification({
        audience: input.audience,
        userId: input.userId,
        type: input.type,
      })
    ) {
      return;
    }

    const userId = input.userId!.trim();
    const devices = await this.prisma.pushDevice.findMany({
      where: {
        tenantId: input.tenantId,
        userId,
        disabledAt: null,
      },
      select: { expoPushToken: true },
    });

    if (!devices.length) {
      return;
    }

    const copy = driverPushCopyForType(input.type);
    const data: Record<string, string> = {
      type: input.type,
      notificationId: input.id,
      tenantId: input.tenantId,
    };
    if (input.jobId) data.jobId = input.jobId;
    if (input.tripId) data.tripId = input.tripId;

    const messages: ExpoPushMessage[] = devices.map((d) => ({
      to: d.expoPushToken,
      title: copy.title,
      body: copy.body,
      data,
      sound: "default",
    }));

    const { invalidTokens } = await sendExpoPushMessages(
      messages,
      sendFn ?? defaultExpoSend,
    );
    await this.disableInvalidTokens(invalidTokens);
  }

  private async disableInvalidTokens(tokens: string[]): Promise<void> {
    if (!tokens.length) {
      return;
    }
    await this.prisma.pushDevice.updateMany({
      where: { expoPushToken: { in: tokens }, disabledAt: null },
      data: { disabledAt: new Date() },
    });
    this.logger.debug(`Disabled ${tokens.length} invalid Expo push token(s)`);
  }
}

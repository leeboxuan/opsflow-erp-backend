import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from "@nestjs/common";
import { NotificationAudience, NotificationSeverity, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeEventsService } from "../realtime/realtime-events.service";
import type { RealtimeEvent } from "../realtime/realtime-event.types";
import {
  buildNotificationSpecsFromRealtimeEvent,
  dedupeKeyForSpec,
  type NotificationCreateSpec,
} from "./notification-from-realtime";
import {
  NotificationDto,
  NotificationsListResponseDto,
} from "./dto/notification.dto";
import {
  NotificationViewerContext,
  assertNotificationViewerAllowed,
  buildNotificationVisibilityWhere,
  canViewerAccessNotification,
} from "./notifications.visibility";
import { resolveRecipientUserIds } from "./notifications.recipients";
import { PushNotificationsService } from "../push/push-notifications.service";
import { shouldSendDriverPushForNotification } from "../push/push-driver-rules";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const DEDUPE_WINDOW_MS = 3_000;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly recentDedupe = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RealtimeEventsService))
    private readonly realtime: RealtimeEventsService,
    @Optional() private readonly pushNotifications?: PushNotificationsService,
  ) {}

  /** @internal */
  resetDedupeCache(): void {
    this.recentDedupe.clear();
  }

  async createFromRealtimeEvent(event: RealtimeEvent): Promise<void> {
    const specs = buildNotificationSpecsFromRealtimeEvent(event);
    if (!specs.length) {
      return;
    }

    for (const spec of specs) {
      if (this.isDuplicate(spec)) {
        continue;
      }

      try {
        const created = await this.prisma.$transaction(async (tx) => {
          const notification = await tx.notification.create({
            data: {
              tenantId: spec.tenantId,
              userId: spec.userId ?? null,
              role: spec.role ?? null,
              audience: spec.audience,
              type: spec.type,
              title: spec.title,
              description: spec.description ?? null,
              severity: spec.severity,
              entityType: spec.entityType ?? null,
              entityId: spec.entityId ?? null,
              jobId: spec.jobId ?? null,
              tripId: spec.tripId ?? null,
              driverUserId: spec.driverUserId ?? null,
              metadata:
                spec.metadata === null || spec.metadata === undefined
                  ? Prisma.JsonNull
                  : (spec.metadata as Prisma.InputJsonValue),
            },
          });

          const userIds = await resolveRecipientUserIds(tx, spec);
          if (userIds.length) {
            await tx.notificationRecipient.createMany({
              data: userIds.map((userId) => ({
                notificationId: notification.id,
                tenantId: spec.tenantId,
                userId,
              })),
              skipDuplicates: true,
            });
          }

          return notification;
        });

        this.publishNotificationCreated(created, event.changedAt);
        this.enqueueDriverPush(created);
      } catch (err) {
        this.logger.warn(
          `Failed to persist notification for ${event.type}: ${(err as Error).message}`,
        );
      }
    }
  }

  async list(
    ctx: NotificationViewerContext,
    query: { limit?: unknown; cursor?: string },
  ): Promise<NotificationsListResponseDto> {
    assertNotificationViewerAllowed(ctx.role);

    const limit = clampLimit(query.limit);
    const cursorFilter = await this.buildRecipientCursorFilter(
      ctx,
      query.cursor,
    );

    const rows = await this.prisma.notificationRecipient.findMany({
      where: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        notification: buildNotificationVisibilityWhere(ctx),
        ...cursorFilter,
      },
      include: { notification: true },
      orderBy: [
        { notification: { createdAt: "desc" } },
        { notificationId: "desc" },
        { id: "desc" },
      ],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      data: page.map((row) =>
        toNotificationDto(row.notification, row.readAt),
      ),
      nextCursor,
    };
  }

  async unreadCount(ctx: NotificationViewerContext): Promise<number> {
    assertNotificationViewerAllowed(ctx.role);
    return this.prisma.notificationRecipient.count({
      where: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        readAt: null,
        notification: buildNotificationVisibilityWhere(ctx),
      },
    });
  }

  async markRead(
    ctx: NotificationViewerContext,
    notificationId: string,
  ): Promise<NotificationDto> {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, tenantId: ctx.tenantId },
    });
    if (!notification) {
      throw new NotFoundException("Notification not found");
    }
    if (!canViewerAccessNotification(ctx, notification)) {
      throw new ForbiddenException("Notification not visible to current user");
    }

    const recipient = await this.prisma.notificationRecipient.upsert({
      where: {
        notificationId_userId: {
          notificationId: notification.id,
          userId: ctx.userId,
        },
      },
      create: {
        notificationId: notification.id,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        readAt: new Date(),
      },
      update: {
        readAt: new Date(),
      },
    });

    return toNotificationDto(notification, recipient.readAt);
  }

  async markAllRead(ctx: NotificationViewerContext): Promise<number> {
    assertNotificationViewerAllowed(ctx.role);

    const visible = await this.prisma.notification.findMany({
      where: buildNotificationVisibilityWhere(ctx),
      select: { id: true },
    });

    if (!visible.length) {
      return 0;
    }

    const notificationIds = visible.map((row) => row.id);
    const now = new Date();

    const updated = await this.prisma.notificationRecipient.updateMany({
      where: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        readAt: null,
        notificationId: { in: notificationIds },
      },
      data: { readAt: now },
    });

    const existing = await this.prisma.notificationRecipient.findMany({
      where: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        notificationId: { in: notificationIds },
      },
      select: { notificationId: true },
    });
    const have = new Set(existing.map((row) => row.notificationId));
    const missing = visible.filter((row) => !have.has(row.id));

    if (missing.length) {
      await this.prisma.notificationRecipient.createMany({
        data: missing.map((row) => ({
          notificationId: row.id,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          readAt: now,
        })),
        skipDuplicates: true,
      });
    }

    return updated.count + missing.length;
  }

  private publishNotificationCreated(
    notification: {
      id: string;
      tenantId: string;
      userId: string | null;
      jobId: string | null;
      tripId: string | null;
      driverUserId: string | null;
    },
    changedAt?: string,
  ): void {
    this.realtime.publish({
      type: "notification.created",
      tenantId: notification.tenantId,
      entityType: "notification",
      entityId: notification.id,
      jobId: notification.jobId ?? undefined,
      tripId: notification.tripId ?? undefined,
      driverUserId: notification.userId ?? notification.driverUserId ?? undefined,
      changedAt,
    });
  }

  private enqueueDriverPush(notification: {
    id: string;
    tenantId: string;
    userId: string | null;
    audience: NotificationAudience;
    type: string;
    jobId: string | null;
    tripId: string | null;
  }): void {
    if (
      !shouldSendDriverPushForNotification({
        audience: notification.audience,
        userId: notification.userId,
        type: notification.type,
      })
    ) {
      return;
    }

    this.pushNotifications?.sendForCreatedNotification({
      id: notification.id,
      tenantId: notification.tenantId,
      userId: notification.userId,
      audience: notification.audience,
      type: notification.type,
      jobId: notification.jobId,
      tripId: notification.tripId,
    });
  }

  private isDuplicate(spec: NotificationCreateSpec): boolean {
    const key = dedupeKeyForSpec(spec);
    const now = Date.now();
    const last = this.recentDedupe.get(key);
    if (last !== undefined && now - last < DEDUPE_WINDOW_MS) {
      return true;
    }
    this.recentDedupe.set(key, now);
    if (this.recentDedupe.size > 5000) {
      const cutoff = now - DEDUPE_WINDOW_MS * 2;
      for (const [k, ts] of this.recentDedupe) {
        if (ts < cutoff) {
          this.recentDedupe.delete(k);
        }
      }
    }
    return false;
  }

  private async buildRecipientCursorFilter(
    ctx: NotificationViewerContext,
    cursor?: string,
  ): Promise<Prisma.NotificationRecipientWhereInput> {
    if (!cursor?.trim()) {
      return {};
    }

    const anchor = await this.prisma.notificationRecipient.findFirst({
      where: {
        id: cursor.trim(),
        tenantId: ctx.tenantId,
        userId: ctx.userId,
      },
      include: { notification: { select: { createdAt: true } } },
    });

    if (!anchor) {
      return {};
    }

    const createdAt = anchor.notification.createdAt;
    return {
      OR: [
        { notification: { createdAt: { lt: createdAt } } },
        {
          notification: { createdAt },
          notificationId: { lt: anchor.notificationId },
        },
        {
          notification: { createdAt },
          notificationId: anchor.notificationId,
          id: { lt: anchor.id },
        },
      ],
    };
  }
}

function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.floor(n));
}

function toNotificationDto(
  row: {
    id: string;
    tenantId: string;
    userId: string | null;
    role: import("@prisma/client").Role | null;
    audience: string;
    type: string;
    title: string;
    description: string | null;
    severity: NotificationSeverity;
    entityType: string | null;
    entityId: string | null;
    jobId: string | null;
    tripId: string | null;
    driverUserId: string | null;
    createdAt: Date;
    metadata: unknown;
  },
  recipientReadAt: Date | null,
): NotificationDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    role: row.role,
    audience: row.audience as NotificationDto["audience"],
    type: row.type,
    title: row.title,
    description: row.description,
    severity: severityToApi(row.severity),
    entityType: row.entityType,
    entityId: row.entityId,
    jobId: row.jobId,
    tripId: row.tripId,
    driverUserId: row.driverUserId,
    readAt: recipientReadAt,
    read: recipientReadAt != null,
    createdAt: row.createdAt,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
  };
}

function severityToApi(
  severity: NotificationSeverity,
): NotificationDto["severity"] {
  return severity.toLowerCase() as NotificationDto["severity"];
}

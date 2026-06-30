import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
  forwardRef,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { Observable, Subject, interval, merge } from "rxjs";
import { finalize, map } from "rxjs/operators";
import type { MessageEvent } from "@nestjs/common";
import { shouldDeliverRealtimeEvent } from "./realtime-event-filter";
import type {
  RealtimeEvent,
  RealtimeEventInput,
  RealtimeSubscriberContext,
} from "./realtime-event.types";
import { NotificationsService } from "../notifications/notifications.service";

const HEARTBEAT_MS = 25_000;
const LOCATION_THROTTLE_MS = 12_000;

/** Parse-safe SSE payload; clients should skip when type === "heartbeat". */
export const REALTIME_HEARTBEAT_PAYLOAD = JSON.stringify({ type: "heartbeat" });

interface RealtimeSubscriber extends RealtimeSubscriberContext {
  id: string;
  subject: Subject<RealtimeEvent>;
}

@Injectable()
export class RealtimeEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeEventsService.name);
  private readonly subscribers = new Map<string, RealtimeSubscriber>();
  private readonly locationLastEmit = new Map<string, number>();

  constructor(
    @Optional()
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications?: NotificationsService,
  ) {}

  onModuleDestroy(): void {
    for (const sub of this.subscribers.values()) {
      sub.subject.complete();
    }
    this.subscribers.clear();
  }

  publish(input: RealtimeEventInput): RealtimeEvent {
    const event: RealtimeEvent = {
      ...input,
      changedAt: input.changedAt ?? new Date().toISOString(),
    };

    for (const sub of this.subscribers.values()) {
      if (!shouldDeliverRealtimeEvent(event, sub)) {
        continue;
      }
      sub.subject.next(event);
    }

    if (event.type !== "notification.created") {
      void this.persistNotificationFromEvent(event);
    }

    return event;
  }

  private persistNotificationFromEvent(event: RealtimeEvent): void {
    if (!this.notifications) {
      return;
    }
    void this.notifications.createFromRealtimeEvent(event).catch((err) => {
      this.logger.warn(
        `Notification persistence failed for ${event.type}: ${(err as Error).message}`,
      );
    });
  }

  publishDispatchAndDashboard(
    tenantId: string,
    partial?: Pick<
      RealtimeEventInput,
      "jobId" | "tripId" | "driverUserId" | "reason"
    >,
  ): void {
    const changedAt = new Date().toISOString();
    this.publish({
      type: "dispatch.updated",
      tenantId,
      entityType: "dispatch",
      changedAt,
      ...partial,
    });
    this.publish({
      type: "dashboard.updated",
      tenantId,
      entityType: "dashboard",
      changedAt,
      ...partial,
    });
  }

  /**
   * Throttled driver GPS / dispatch refresh (~12s per driver per tenant).
   */
  publishDriverLocationUpdated(
    tenantId: string,
    driverUserId: string,
    partial?: Pick<RealtimeEventInput, "jobId" | "tripId">,
  ): void {
    const throttleKey = `${tenantId}:${driverUserId}`;
    const now = Date.now();
    const last = this.locationLastEmit.get(throttleKey) ?? 0;
    if (now - last < LOCATION_THROTTLE_MS) {
      return;
    }
    this.locationLastEmit.set(throttleKey, now);

    this.publish({
      type: "driver.location.updated",
      tenantId,
      entityType: "driver",
      entityId: driverUserId,
      driverUserId,
      ...partial,
    });
    this.publish({
      type: "dispatch.updated",
      tenantId,
      entityType: "dispatch",
      driverUserId,
      ...partial,
      reason: "driver.location.updated",
    });
  }

  /** @internal — reset throttle state (tests). */
  resetLocationThrottle(): void {
    this.locationLastEmit.clear();
  }

  stream(context: RealtimeSubscriberContext): Observable<MessageEvent> {
    const subject = new Subject<RealtimeEvent>();
    const id = randomUUID();
    const subscriber: RealtimeSubscriber = { id, subject, ...context };
    this.subscribers.set(id, subscriber);

    this.logger.debug(
      `SSE subscriber connected tenant=${context.tenantId} role=${context.role} user=${context.userId}`,
    );

    const events$ = subject.asObservable().pipe(
      map(
        (event): MessageEvent => ({
          data: JSON.stringify(event),
        }),
      ),
    );

    const heartbeat$ = interval(HEARTBEAT_MS).pipe(
      map(
        (): MessageEvent => ({
          type: "heartbeat",
          data: REALTIME_HEARTBEAT_PAYLOAD,
        }),
      ),
    );

    return merge(events$, heartbeat$).pipe(
      finalize(() => {
        this.subscribers.delete(id);
        subject.complete();
        this.logger.debug(
          `SSE subscriber disconnected tenant=${context.tenantId} user=${context.userId}`,
        );
      }),
    );
  }

  /** @internal — subscriber count for tests. */
  getSubscriberCount(): number {
    return this.subscribers.size;
  }
}

import { ForbiddenException } from "@nestjs/common";
import { NotificationAudience, Prisma, Role } from "@prisma/client";
import {
  isTransportStaffRole,
  TRANSPORT_STAFF_COMPAT_ROLES,
} from "../auth/role-compat";

const OFFICE_NOTIFY_ROLES = new Set<Role>([
  Role.ADMIN,
  Role.TRANSPORT_STAFF,
  Role.OPS,
  Role.FINANCE,
]);

export interface NotificationViewerContext {
  tenantId: string;
  userId: string;
  role: Role;
}

export function assertNotificationViewerAllowed(role: Role): void {
  if (role === Role.CUSTOMER) {
    throw new ForbiddenException("Notifications are not available for customer users");
  }
}

export function buildNotificationVisibilityWhere(
  ctx: NotificationViewerContext,
): Prisma.NotificationWhereInput {
  assertNotificationViewerAllowed(ctx.role);

  const or: Prisma.NotificationWhereInput[] = [
    {
      audience: NotificationAudience.USER,
      userId: ctx.userId,
    },
  ];

  if (ctx.role === Role.DRIVER) {
    or.push({
      audience: NotificationAudience.ROLE,
      role: Role.DRIVER,
    });
  } else if (isTransportStaffRole(ctx.role)) {
    or.push({
      audience: NotificationAudience.ROLE,
      role: { in: [...TRANSPORT_STAFF_COMPAT_ROLES] },
    });
    or.push({ audience: NotificationAudience.TENANT });
  } else if (OFFICE_NOTIFY_ROLES.has(ctx.role)) {
    or.push({
      audience: NotificationAudience.ROLE,
      role: ctx.role,
    });
    or.push({ audience: NotificationAudience.TENANT });
  }

  return {
    tenantId: ctx.tenantId,
    OR: or,
  };
}

export function canViewerAccessNotification(
  ctx: NotificationViewerContext,
  notification: {
    tenantId: string;
    audience: NotificationAudience;
    userId: string | null;
    role: Role | null;
  },
): boolean {
  if (notification.tenantId !== ctx.tenantId) {
    return false;
  }
  if (ctx.role === Role.CUSTOMER) {
    return false;
  }
  if (
    notification.audience === NotificationAudience.USER &&
    notification.userId === ctx.userId
  ) {
    return true;
  }
  if (notification.audience === NotificationAudience.ROLE) {
    if (notification.role === ctx.role) return true;
    if (
      isTransportStaffRole(ctx.role) &&
      isTransportStaffRole(notification.role)
    ) {
      return true;
    }
  }
  if (
    notification.audience === NotificationAudience.TENANT &&
    OFFICE_NOTIFY_ROLES.has(ctx.role)
  ) {
    return true;
  }
  return false;
}

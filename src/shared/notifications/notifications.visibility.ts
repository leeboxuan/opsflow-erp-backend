import { ForbiddenException } from "@nestjs/common";
import { NotificationAudience, Prisma, Role } from "@prisma/client";

const OPS_ROLES = new Set<Role>([Role.ADMIN, Role.OPS, Role.FINANCE]);

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
  } else if (OPS_ROLES.has(ctx.role)) {
    or.push({
      audience: NotificationAudience.ROLE,
      role: ctx.role,
    });
    if (OPS_ROLES.has(ctx.role)) {
      or.push({ audience: NotificationAudience.TENANT });
    }
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
  if (
    notification.audience === NotificationAudience.ROLE &&
    notification.role === ctx.role
  ) {
    return true;
  }
  if (
    notification.audience === NotificationAudience.TENANT &&
    OPS_ROLES.has(ctx.role)
  ) {
    return true;
  }
  return false;
}

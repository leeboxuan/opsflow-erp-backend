import { ForbiddenException } from "@nestjs/common";
import { CanonicalTenantRole, NotificationAudience, Prisma, Role } from "@prisma/client";
import { isCustomerAdminOnly } from "../auth/access-surface";
import {
  hasRole,
  toCanonicalTenantRoles,
  type RoleLike,
} from "../auth/canonical-tenant-role";
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
  roles?: readonly RoleLike[] | null;
}

function viewerRoles(ctx: NotificationViewerContext): CanonicalTenantRole[] {
  if (ctx.roles?.length) return toCanonicalTenantRoles(ctx.roles);
  return toCanonicalTenantRoles([ctx.role]);
}

export function assertNotificationViewerAllowed(role: Role): void {
  if (role === Role.CUSTOMER) {
    throw new ForbiddenException("Notifications are not available for customer users");
  }
}

export function buildNotificationVisibilityWhere(
  ctx: NotificationViewerContext,
): Prisma.NotificationWhereInput {
  const roles = viewerRoles(ctx);
  if (isCustomerAdminOnly(roles) || ctx.role === Role.CUSTOMER) {
    assertNotificationViewerAllowed(Role.CUSTOMER);
  }

  const or: Prisma.NotificationWhereInput[] = [
    {
      audience: NotificationAudience.USER,
      userId: ctx.userId,
    },
  ];

  const seesDriver = hasRole(roles, CanonicalTenantRole.TRANSPORT_DRIVER);
  const seesOps =
    hasRole(roles, CanonicalTenantRole.TRANSPORT_ADMIN) ||
    hasRole(roles, CanonicalTenantRole.TENANT_ADMIN);
  const seesOffice =
    seesOps ||
    hasRole(roles, CanonicalTenantRole.FINANCE_ADMIN) ||
    hasRole(roles, CanonicalTenantRole.WAREHOUSE_ADMIN) ||
    hasRole(roles, CanonicalTenantRole.WAREHOUSE_STAFF) ||
    OFFICE_NOTIFY_ROLES.has(ctx.role);

  if (seesDriver) {
    or.push({
      audience: NotificationAudience.ROLE,
      role: Role.DRIVER,
    });
  }
  if (seesOps) {
    or.push({
      audience: NotificationAudience.ROLE,
      role: { in: [...TRANSPORT_STAFF_COMPAT_ROLES] },
    });
    or.push({ audience: NotificationAudience.TENANT });
  } else if (seesOffice) {
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
  const roles = viewerRoles(ctx);
  if (isCustomerAdminOnly(roles) || ctx.role === Role.CUSTOMER) {
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
      hasRole(roles, CanonicalTenantRole.TRANSPORT_DRIVER) &&
      notification.role === Role.DRIVER
    ) {
      return true;
    }
    if (
      (hasRole(roles, CanonicalTenantRole.TRANSPORT_ADMIN) ||
        hasRole(roles, CanonicalTenantRole.TENANT_ADMIN)) &&
      isTransportStaffRole(notification.role)
    ) {
      return true;
    }
    if (
      isTransportStaffRole(ctx.role) &&
      isTransportStaffRole(notification.role)
    ) {
      return true;
    }
  }
  if (
    notification.audience === NotificationAudience.TENANT &&
    (OFFICE_NOTIFY_ROLES.has(ctx.role) ||
      hasRole(roles, CanonicalTenantRole.TENANT_ADMIN) ||
      hasRole(roles, CanonicalTenantRole.TRANSPORT_ADMIN) ||
      hasRole(roles, CanonicalTenantRole.FINANCE_ADMIN) ||
      hasRole(roles, CanonicalTenantRole.WAREHOUSE_ADMIN) ||
      hasRole(roles, CanonicalTenantRole.WAREHOUSE_STAFF))
  ) {
    return true;
  }
  return false;
}

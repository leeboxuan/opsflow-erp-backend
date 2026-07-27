import {
  MembershipStatus,
  NotificationAudience,
  Prisma,
  Role,
} from "@prisma/client";
import type { NotificationCreateSpec } from "./notification-from-realtime";
import {
  isTransportStaffRole,
  TRANSPORT_STAFF_COMPAT_ROLES,
} from "../auth/role-compat";

/** Office staff who receive tenant-wide notifications (includes deprecated OPS). */
const OFFICE_NOTIFY_ROLES: Role[] = [
  Role.ADMIN,
  Role.TRANSPORT_STAFF,
  Role.OPS,
  Role.FINANCE,
];

type PrismaLike = {
  tenantMembership: {
    findMany: (args: {
      where: Prisma.TenantMembershipWhereInput;
      select: { userId: true };
    }) => Promise<Array<{ userId: string }>>;
  };
};

/**
 * Resolve distinct user ids that should receive a notification row.
 */
export async function resolveRecipientUserIds(
  prisma: PrismaLike,
  spec: Pick<
    NotificationCreateSpec,
    "tenantId" | "audience" | "userId" | "role"
  >,
): Promise<string[]> {
  if (spec.audience === NotificationAudience.USER) {
    return spec.userId ? [spec.userId] : [];
  }

  if (spec.audience === NotificationAudience.ROLE) {
    if (!spec.role) return [];
    const roleFilter = isTransportStaffRole(spec.role)
      ? { in: [...TRANSPORT_STAFF_COMPAT_ROLES] }
      : spec.role;
    const rows = await prisma.tenantMembership.findMany({
      where: {
        tenantId: spec.tenantId,
        role: roleFilter,
        status: MembershipStatus.Active,
      },
      select: { userId: true },
    });
    return uniqueUserIds(rows);
  }

  if (spec.audience === NotificationAudience.TENANT) {
    const rows = await prisma.tenantMembership.findMany({
      where: {
        tenantId: spec.tenantId,
        role: { in: OFFICE_NOTIFY_ROLES },
        status: MembershipStatus.Active,
      },
      select: { userId: true },
    });
    return uniqueUserIds(rows);
  }

  return [];
}

function uniqueUserIds(rows: Array<{ userId: string }>): string[] {
  return [...new Set(rows.map((r) => r.userId))];
}

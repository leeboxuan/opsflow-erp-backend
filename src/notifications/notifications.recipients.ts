import {
  MembershipStatus,
  NotificationAudience,
  Prisma,
  Role,
} from "@prisma/client";
import type { NotificationCreateSpec } from "./notification-from-realtime";

const OPS_ROLES: Role[] = [Role.ADMIN, Role.OPS, Role.FINANCE];

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
    const rows = await prisma.tenantMembership.findMany({
      where: {
        tenantId: spec.tenantId,
        role: spec.role,
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
        role: { in: OPS_ROLES },
        status: MembershipStatus.Active,
      },
      select: { userId: true },
    });
    return uniqueUserIds(rows);
  }

  return [];
}

function uniqueUserIds(rows: Array<{ userId: string }>): string[] {
  return [...new Set(rows.map((r) => r.userId).filter(Boolean))];
}

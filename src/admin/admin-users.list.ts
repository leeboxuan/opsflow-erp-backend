import { CanonicalTenantRole, MembershipStatus, Prisma, Role } from '@prisma/client';
import { parsePaginationFromQuery, buildPaginationMeta } from '../shared/common/pagination';
import { applyMappedFilter } from '../shared/common/listing/listing.filters';
import { buildOrderBy } from '../shared/common/listing/listing.sort';
import { PrismaService } from '../shared/prisma/prisma.service';
import { parseTenantRoleListFilter, tenantRoleFilterWhere } from './admin-users.util';
import {
  mapTenantMembershipToPublicUserDto,
  type PublicAdminUserDto,
} from './admin-users.mapper';

export type ListTenantUsersQuery = {
  page?: number;
  pageSize?: number;
  q?: string;
  filter?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  role?: Role | string;
  roles?: string;
};

export type ListTenantUsersOptions = {
  /** When set, only these roles are listed (e.g. warehousing compatibility wrapper). */
  forcedRoles?: readonly Role[];
  /** Exclude DRIVER from admin users list (default true for canonical admin list). */
  excludeDriver?: boolean;
  /**
   * Transport Admin user list: only memberships whose canonical set is a subset
   * of these roles (no privileged/internal extras).
   */
  restrictToExactlyCanonicalRoles?: readonly CanonicalTenantRole[];
};

/**
 * Canonical tenant user list query used by GET /admin/users and compatibility wrappers.
 */
export async function listTenantUsers(
  prisma: PrismaService,
  tenantId: string,
  query: ListTenantUsersQuery,
  options: ListTenantUsersOptions = {},
): Promise<{
  data: PublicAdminUserDto[];
  meta: { page: number; pageSize: number; total: number };
}> {
  const { page, pageSize, skip, take } = parsePaginationFromQuery(query);
  const excludeDriver = options.excludeDriver !== false;

  const where: Prisma.TenantMembershipWhereInput = {
    tenantId,
  };

  if (options.restrictToExactlyCanonicalRoles?.length) {
    const allowed = [...options.restrictToExactlyCanonicalRoles];
    const forbidden = (
      Object.values(CanonicalTenantRole) as CanonicalTenantRole[]
    ).filter((role) => !allowed.includes(role));
    where.AND = [
      {
        membershipRoles: {
          some: { role: { in: allowed } },
        },
      },
      forbidden.length
        ? {
            membershipRoles: {
              none: { role: { in: forbidden } },
            },
          }
        : {},
    ];
  } else if (excludeDriver && !options.forcedRoles?.length) {
    where.NOT = {
      AND: [
        {
          OR: [
            { role: Role.DRIVER },
            {
              membershipRoles: {
                some: { role: CanonicalTenantRole.TRANSPORT_DRIVER },
              },
            },
          ],
        },
        {
          membershipRoles: {
            none: {
              role: {
                in: [
                  CanonicalTenantRole.TENANT_ADMIN,
                  CanonicalTenantRole.TRANSPORT_ADMIN,
                  CanonicalTenantRole.FINANCE_ADMIN,
                  CanonicalTenantRole.WAREHOUSE_ADMIN,
                  CanonicalTenantRole.WAREHOUSE_STAFF,
                  CanonicalTenantRole.CUSTOMER_ADMIN,
                ],
              },
            },
          },
        },
      ],
    };
  }

  const q = query.q?.trim();
  if (q) {
    where.user = {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { username: { contains: q, mode: 'insensitive' } },
      ],
    };
  }

  applyMappedFilter(where, query.filter, {
    active: { status: MembershipStatus.Active },
    invited: { status: MembershipStatus.Invited },
    suspended: { status: MembershipStatus.Suspended },
  });

  if (options.forcedRoles?.length) {
    const parsedForced = parseTenantRoleListFilter(
      undefined,
      options.forcedRoles.join(','),
    );
    Object.assign(where, parsedForced ? tenantRoleFilterWhere(parsedForced) : {});
  } else {
    const parsed = parseTenantRoleListFilter(query.role, query.roles);
    if (parsed) {
      Object.assign(where, tenantRoleFilterWhere(parsed));
    }
  }

  const orderBy =
    query.sortBy === 'name' || query.sortBy === 'email'
      ? {
          user: {
            [query.sortBy]: query.sortDir === 'desc' ? 'desc' : 'asc',
          },
        }
      : buildOrderBy(
          query.sortBy,
          query.sortDir,
          ['createdAt', 'updatedAt'],
          { createdAt: 'desc' },
        );

  const [total, memberships] = await prisma.$transaction([
    prisma.tenantMembership.count({ where }),
    prisma.tenantMembership.findMany({
      where,
      include: {
        user: true,
        membershipRoles: { select: { role: true } },
      },
      orderBy: orderBy as Prisma.TenantMembershipOrderByWithRelationInput,
      skip,
      take,
    }),
  ]);

  return {
    data: memberships.map((m) => mapTenantMembershipToPublicUserDto(m)),
    meta: buildPaginationMeta(page, pageSize, total),
  };
}

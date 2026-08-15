import { CanonicalTenantRole } from '@prisma/client';
import {
  hasRole,
  toCanonicalTenantRoles,
  type RoleLike,
} from './canonical-tenant-role';
import { actorRolesFromTenantContext } from './tenant-role-assignment';
import {
  isCustomerAdminOnly,
  isTransportDriverOnly,
} from './access-surface';

export type AccessActor = {
  userId?: string;
  role?: RoleLike;
  roles: CanonicalTenantRole[];
  customerCompanyId?: string | null;
  [key: string]: unknown;
};

export function actorRolesFromRequest(req: {
  tenant?: {
    roles?: readonly RoleLike[] | null;
    role?: RoleLike;
    isPlatformAdmin?: boolean;
    authMode?: string;
  };
}): CanonicalTenantRole[] {
  return actorRolesFromTenantContext(req.tenant ?? {});
}

/** Authorization actor: canonical role SET is truth. Singular `role` is compatibility only. */
export function accessActorFromRequest(req: any): AccessActor {
  const roles = actorRolesFromRequest(req);
  return {
    ...(req?.user ?? {}),
    userId: req?.user?.userId ?? req?.user?.id,
    role: req?.tenant?.role,
    roles,
    customerCompanyId:
      req?.tenant?.customerCompanyId ?? req?.user?.customerCompanyId ?? null,
  };
}

export function actorIsCustomerAdmin(actor: {
  roles?: readonly RoleLike[] | null;
  role?: RoleLike;
}): boolean {
  return hasRole(actor.roles?.length ? actor.roles : actor.role, CanonicalTenantRole.CUSTOMER_ADMIN);
}

export function actorIsFinanceAdminOnly(actor: {
  roles?: readonly RoleLike[] | null;
  role?: RoleLike;
}): boolean {
  const roles = toCanonicalTenantRoles(
    actor.roles?.length ? actor.roles : actor.role != null ? [actor.role] : [],
  );
  return (
    hasRole(roles, CanonicalTenantRole.FINANCE_ADMIN) &&
    !hasRole(roles, CanonicalTenantRole.TENANT_ADMIN) &&
    !hasRole(roles, CanonicalTenantRole.TRANSPORT_ADMIN)
  );
}

export function actorIsDriverOnly(actor: {
  roles?: readonly RoleLike[] | null;
  role?: RoleLike;
}): boolean {
  return isTransportDriverOnly(
    actor.roles?.length ? actor.roles : actor.role,
  );
}

export function actorIsCustomerOnly(actor: {
  roles?: readonly RoleLike[] | null;
  role?: RoleLike;
}): boolean {
  return isCustomerAdminOnly(
    actor.roles?.length ? actor.roles : actor.role,
  );
}

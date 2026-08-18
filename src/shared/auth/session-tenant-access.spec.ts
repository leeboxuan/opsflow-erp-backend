import { MembershipStatus, TenantStatus } from "@prisma/client";
import {
  filterVisibleSessionMemberships,
  isOrdinaryMembershipAccessible,
  isPlatformOperatedTenantAllowed,
  resolveRequestedMembershipTenantId,
} from "./session-tenant-access";

describe("session-tenant-access", () => {
  const active = {
    tenantId: "t1",
    status: MembershipStatus.Active,
    tenant: { status: TenantStatus.ACTIVE },
  };

  it("accepts an active membership on an ACTIVE tenant", () => {
    expect(isOrdinaryMembershipAccessible(active)).toBe(true);
  });

  it("rejects inactive memberships", () => {
    expect(
      isOrdinaryMembershipAccessible({
        ...active,
        status: MembershipStatus.Suspended,
      }),
    ).toBe(false);
    expect(
      isOrdinaryMembershipAccessible({
        ...active,
        status: MembershipStatus.Invited,
      }),
    ).toBe(false);
  });

  it("rejects suspended or archived tenants for ordinary members", () => {
    expect(
      isOrdinaryMembershipAccessible({
        ...active,
        tenant: { status: TenantStatus.SUSPENDED },
      }),
    ).toBe(false);
    expect(
      isOrdinaryMembershipAccessible({
        ...active,
        tenant: { status: TenantStatus.ARCHIVED },
      }),
    ).toBe(false);
  });

  it("filters ordinary memberships to accessible ones only", () => {
    const visible = filterVisibleSessionMemberships(
      [
        active,
        { tenantId: "t2", status: MembershipStatus.Active, tenant: { status: TenantStatus.SUSPENDED } },
        { tenantId: "t3", status: MembershipStatus.Suspended, tenant: { status: TenantStatus.ACTIVE } },
        { tenantId: "t4", status: MembershipStatus.Active, tenant: { status: TenantStatus.ARCHIVED } },
      ],
      false,
    );
    expect(visible.map((m) => m.tenantId)).toEqual(["t1"]);
  });

  it("omits archived tenants for platform admins but keeps suspended", () => {
    const visible = filterVisibleSessionMemberships(
      [
        { tenantId: "t1", status: MembershipStatus.Active, tenant: { status: TenantStatus.SUSPENDED } },
        { tenantId: "t2", status: MembershipStatus.Active, tenant: { status: TenantStatus.ARCHIVED } },
      ],
      true,
    );
    expect(visible.map((m) => m.tenantId)).toEqual(["t1"]);
  });

  it("does not silently choose the first membership when the header is missing or unknown", () => {
    const memberships = [active, { tenantId: "t2", status: MembershipStatus.Active, tenant: { status: TenantStatus.ACTIVE } }];
    expect(
      resolveRequestedMembershipTenantId({
        requestedTenantId: null,
        visibleMemberships: memberships,
      }),
    ).toBeUndefined();
    expect(
      resolveRequestedMembershipTenantId({
        requestedTenantId: "unknown",
        visibleMemberships: memberships,
      }),
    ).toBeUndefined();
  });

  it("returns the header tenant only when it matches a visible membership", () => {
    expect(
      resolveRequestedMembershipTenantId({
        requestedTenantId: "t2",
        visibleMemberships: [
          active,
          { tenantId: "t2", status: MembershipStatus.Active, tenant: { status: TenantStatus.ACTIVE } },
        ],
      }),
    ).toBe("t2");
  });

  it("blocks platform-operated archived tenants", () => {
    expect(isPlatformOperatedTenantAllowed(TenantStatus.ACTIVE)).toBe(true);
    expect(isPlatformOperatedTenantAllowed(TenantStatus.SUSPENDED)).toBe(true);
    expect(isPlatformOperatedTenantAllowed(TenantStatus.ARCHIVED)).toBe(false);
  });
});

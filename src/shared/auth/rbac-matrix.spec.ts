import { Reflector } from "@nestjs/core";
import { CanonicalTenantRole, Role } from "@prisma/client";
import { DashboardController } from "../../dashboard/dashboard.controller";
import { INTERNAL_STAFF_ROLES } from "./canonical-tenant-role";
import { InventoryController } from "../../warehousing/inventory/inventory.controller";
import { DispatchController } from "../../transport/dispatch/dispatch.controller";
import { TransportJobsController } from "../../transport/jobs/transport-jobs.controller";
import { DriverIncentivesController } from "../../transport/finance/driver-incentives.controller";
import { ACCESS_SURFACE_KEY } from "./guards/access-surface.guard";

describe("canonical RBAC controller matrix", () => {
  const reflector = new Reflector();

  it("Jobs class allows TENANT_ADMIN, TRANSPORT_ADMIN, CUSTOMER_ADMIN on portal surface and excludes FINANCE", () => {
    expect(Reflect.getMetadata("roles", TransportJobsController)).toEqual([
      CanonicalTenantRole.TENANT_ADMIN,
      CanonicalTenantRole.TRANSPORT_ADMIN,
      CanonicalTenantRole.CUSTOMER_ADMIN,
    ]);
    expect(Reflect.getMetadata(ACCESS_SURFACE_KEY, TransportJobsController)).toBe(
      "portal",
    );
    expect(
      reflector.getAllAndOverride("roles", [
        TransportJobsController.prototype.create,
        TransportJobsController,
      ]),
    ).not.toContain(CanonicalTenantRole.FINANCE_ADMIN);
    expect(
      reflector.getAllAndOverride("roles", [
        TransportJobsController.prototype.create,
        TransportJobsController,
      ]),
    ).not.toContain(Role.FINANCE);
  });

  it("Dashboard summary is internal staff only", () => {
    expect(
      Reflect.getMetadata("roles", DashboardController.prototype.getSummary),
    ).toEqual([...INTERNAL_STAFF_ROLES]);
  });

  it("Inventory reads include warehouse staff; mutations require warehouse admin", () => {
    expect(Reflect.getMetadata("roles", InventoryController)).toEqual([
      CanonicalTenantRole.TENANT_ADMIN,
      CanonicalTenantRole.WAREHOUSE_ADMIN,
      CanonicalTenantRole.WAREHOUSE_STAFF,
    ]);
    expect(
      Reflect.getMetadata("roles", InventoryController.prototype.createBatch),
    ).toEqual([
      CanonicalTenantRole.TENANT_ADMIN,
      CanonicalTenantRole.WAREHOUSE_ADMIN,
    ]);
    expect(
      Reflect.getMetadata(
        "roles",
        InventoryController.prototype.deleteInventoryItem,
      ),
    ).toEqual([
      CanonicalTenantRole.TENANT_ADMIN,
      CanonicalTenantRole.WAREHOUSE_ADMIN,
    ]);
  });

  it("Dispatch is transport ops only (no finance)", () => {
    expect(Reflect.getMetadata("roles", DispatchController)).toEqual([
      Role.ADMIN,
      Role.TRANSPORT_STAFF,
    ]);
  });

  it("Driver Incentives is read-only TENANT_ADMIN / FINANCE", () => {
    expect(Reflect.getMetadata("roles", DriverIncentivesController)).toEqual([
      Role.ADMIN,
      Role.FINANCE,
    ]);
    expect(
      Object.getOwnPropertyNames(DriverIncentivesController.prototype),
    ).toEqual(expect.arrayContaining(["list", "detail"]));
    expect(DriverIncentivesController.prototype).not.toHaveProperty("patch");
  });
});

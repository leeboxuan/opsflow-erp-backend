import { GUARDS_METADATA } from "@nestjs/common/constants";
import { CanonicalTenantRole } from "@prisma/client";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import { RoleGuard } from "../shared/auth/guards/role.guard";
import { TenantGuard } from "../shared/auth/guards/tenant.guard";
import { CustomersController } from "./customers.controller";

describe("CustomersController directory RoleGuard", () => {
  it("guards tenant-wide company listing so CUSTOMER and DRIVER cannot enumerate companies", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CustomersController)).toEqual([
      AuthGuard,
      TenantGuard,
      RoleGuard,
    ]);
    expect(Reflect.getMetadata("roles", CustomersController)).toEqual([
      CanonicalTenantRole.TENANT_ADMIN,
      CanonicalTenantRole.TRANSPORT_ADMIN,
      CanonicalTenantRole.FINANCE_ADMIN,
      CanonicalTenantRole.WAREHOUSE_ADMIN,
      CanonicalTenantRole.WAREHOUSE_STAFF,
    ]);
    expect(Reflect.getMetadata("roles", CustomersController.prototype.createCompany)).toEqual([
      CanonicalTenantRole.TENANT_ADMIN,
      CanonicalTenantRole.TRANSPORT_ADMIN,
    ]);
  });
});

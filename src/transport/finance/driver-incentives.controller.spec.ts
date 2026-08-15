import { RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { Role, TenantModule } from "@prisma/client";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import {
  ModuleEntitlementGuard,
  REQUIRES_TENANT_MODULE_KEY,
} from "../../shared/auth/guards/module-entitlement.guard";
import { RoleGuard } from "../../shared/auth/guards/role.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { DriverIncentivesController } from "./driver-incentives.controller";

describe("DriverIncentivesController Finance RBAC", () => {
  const reflector = new Reflector();

  it("is a Finance-module read surface for TENANT_ADMIN and FINANCE_ADMIN only", () => {
    expect(Reflect.getMetadata(PATH_METADATA, DriverIncentivesController)).toBe(
      "finance/driver-incentives",
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, DriverIncentivesController),
    ).toEqual([AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard]);
    expect(
      reflector.getAllAndOverride<TenantModule[]>(REQUIRES_TENANT_MODULE_KEY, [
        DriverIncentivesController.prototype.list,
        DriverIncentivesController,
      ]),
    ).toEqual([TenantModule.FINANCE]);
    expect(
      reflector.getAllAndOverride<Role[]>("roles", [
        DriverIncentivesController.prototype.list,
        DriverIncentivesController,
      ]),
    ).toEqual([Role.ADMIN, Role.FINANCE]);
    expect(
      reflector.getAllAndOverride<Role[]>("roles", [
        DriverIncentivesController.prototype.detail,
        DriverIncentivesController,
      ]),
    ).toEqual([Role.ADMIN, Role.FINANCE]);
  });

  it("exposes list and detail as GET", () => {
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        DriverIncentivesController.prototype.list,
      ),
    ).toBe(RequestMethod.GET);
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        DriverIncentivesController.prototype.detail,
      ),
    ).toBe(RequestMethod.GET);
  });
});

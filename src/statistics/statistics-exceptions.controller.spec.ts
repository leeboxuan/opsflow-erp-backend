import { ForbiddenException, RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { Role, TenantModule } from "@prisma/client";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import {
  ModuleEntitlementGuard,
  REQUIRES_TENANT_MODULE_KEY,
} from "../shared/auth/guards/module-entitlement.guard";
import { RoleGuard } from "../shared/auth/guards/role.guard";
import { TenantGuard } from "../shared/auth/guards/tenant.guard";
import { StatisticsExceptionsDto, StatisticsExceptionsQueryDto } from "./dto";
import { StatisticsController } from "./statistics.controller";
import { StatisticsDriversController } from "./statistics-drivers.controller";
import { StatisticsExceptionsController } from "./statistics-exceptions.controller";
import { StatisticsExceptionsService } from "./statistics-exceptions.service";
import { StatisticsExportController } from "./statistics-export.controller";
import { StatisticsFinanceController } from "./statistics-finance.controller";
import { StatisticsModule } from "./statistics.module";
import { StatisticsOverviewController } from "./statistics-overview.controller";

describe("StatisticsExceptionsController", () => {
  const routeHandler = StatisticsExceptionsController.prototype.getExceptions;

  it("registers Exceptions beside all truthful Statistics controllers", () => {
    const controllers =
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, StatisticsModule) ?? [];
    expect(controllers).toEqual([
      StatisticsOverviewController,
      StatisticsDriversController,
      StatisticsFinanceController,
      StatisticsExceptionsController,
      StatisticsExportController,
    ]);
    expect(controllers).not.toContain(StatisticsController);
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, StatisticsModule),
    ).toContain(StatisticsExceptionsService);
  });

  it("registers GET /api/statistics/exceptions with WP1 DTOs", () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, StatisticsExceptionsController),
    ).toBe("statistics");
    expect(Reflect.getMetadata(PATH_METADATA, routeHandler)).toBe("exceptions");
    expect(Reflect.getMetadata(METHOD_METADATA, routeHandler)).toBe(
      RequestMethod.GET,
    );
    const parameterTypes =
      Reflect.getMetadata(
        "design:paramtypes",
        StatisticsExceptionsController.prototype,
        "getExceptions",
      ) ?? [];
    expect(parameterTypes[1]).toBe(StatisticsExceptionsQueryDto);
    const responses =
      Reflect.getMetadata("swagger/apiResponse", routeHandler) ?? {};
    expect(responses["200"]?.type).toBe(StatisticsExceptionsDto);
  });

  it("uses the complete guard stack and both required entitlements", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, StatisticsExceptionsController),
    ).toEqual([AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard]);
    expect(
      Reflect.getMetadata("roles", StatisticsExceptionsController),
    ).toEqual([Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE]);
    const reflector = new Reflector();
    expect(
      reflector.getAllAndOverride<TenantModule[]>(REQUIRES_TENANT_MODULE_KEY, [
        routeHandler,
        StatisticsExceptionsController,
      ]),
    ).toEqual([TenantModule.TRANSPORT, TenantModule.FINANCE]);
  });

  it("forwards only guarded tenant identity and the validated query", async () => {
    const response: StatisticsExceptionsDto = {
      data: [],
      meta: { page: 1, pageSize: 20, total: 0 },
      countsByKey: [],
      timeZone: "Asia/Singapore",
      generatedAt: new Date(),
      limitations: [],
    };
    const service = {
      getExceptions: jest.fn().mockResolvedValue(response),
    };
    const controller = new StatisticsExceptionsController(service as any);
    const exceptionsQuery = Object.assign(new StatisticsExceptionsQueryDto(), {
      key: "ex_cancelled_trip",
      tenantId: "untrusted-tenant",
    });
    await expect(
      controller.getExceptions(
        {
          tenant: {
            tenantId: "trusted-tenant",
            role: Role.ADMIN,
          },
        },
        exceptionsQuery,
      ),
    ).resolves.toBe(response);
    expect(service.getExceptions).toHaveBeenCalledWith(
      "trusted-tenant",
      exceptionsQuery,
    );
  });

  it("denies unauthorized roles and tenants missing either entitlement", async () => {
    const reflector = new Reflector();
    const contextFor = (role: Role, enabledModules: TenantModule[]) => ({
      switchToHttp: () => ({
        getRequest: () => ({
          tenant: { tenantId: "tenant-1", role },
        }),
      }),
      getHandler: () => routeHandler,
      getClass: () => StatisticsExceptionsController,
      enabledModules,
    });
    expect(() =>
      new RoleGuard(reflector).canActivate(contextFor(Role.DRIVER, []) as any),
    ).toThrow(ForbiddenException);

    const incompleteEntitlementSets: TenantModule[][] = [
      [TenantModule.TRANSPORT],
      [TenantModule.FINANCE],
    ];
    for (const enabledModules of incompleteEntitlementSets) {
      const guard = new ModuleEntitlementGuard(
        {
          tenantModuleEntitlement: {
            findUnique: jest.fn(
              async ({
                where,
              }: {
                where: {
                  tenantId_module: { module: TenantModule };
                };
              }) => ({
                enabled: enabledModules.includes(where.tenantId_module.module),
              }),
            ),
          },
        } as any,
        reflector,
      );
      await expect(
        guard.canActivate(contextFor(Role.ADMIN, enabledModules) as any),
      ).rejects.toThrow(ForbiddenException);
    }
  });
});

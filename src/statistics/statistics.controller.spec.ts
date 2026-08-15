import {
  ForbiddenException,
  RequestMethod,
  UnauthorizedException,
} from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { Role, TenantModule } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import {
  ModuleEntitlementGuard,
  REQUIRES_TENANT_MODULE_KEY,
} from "../shared/auth/guards/module-entitlement.guard";
import { RoleGuard } from "../shared/auth/guards/role.guard";
import { TenantGuard } from "../shared/auth/guards/tenant.guard";
import {
  StatisticsDriversDto,
  StatisticsDriversQueryDto,
  StatisticsExceptionsDto,
  StatisticsExceptionsQueryDto,
  StatisticsFiltersQueryDto,
  StatisticsFinanceDto,
  StatisticsFinanceQueryDto,
  StatisticsOverviewDto,
} from "./dto";
import { StatisticsController } from "./statistics.controller";
import { StatisticsDriversController } from "./statistics-drivers.controller";
import { StatisticsExceptionsController } from "./statistics-exceptions.controller";
import { StatisticsExportController } from "./statistics-export.controller";
import { StatisticsFinanceController } from "./statistics-finance.controller";
import { StatisticsModule } from "./statistics.module";
import { StatisticsOverviewController } from "./statistics-overview.controller";
import { StatisticsTruckingController } from "./statistics-trucking.controller";

type StatisticsHandlerName =
  | "getOverview"
  | "getDrivers"
  | "getFinance"
  | "getExceptions";

const ROUTES: Array<{
  handlerName: StatisticsHandlerName;
  path: string;
  queryType: new () => object;
  responseType: new () => object;
  requiredModules: TenantModule[];
}> = [
  {
    handlerName: "getOverview",
    path: "overview",
    queryType: StatisticsFiltersQueryDto,
    responseType: StatisticsOverviewDto,
    requiredModules: [TenantModule.TRANSPORT],
  },
  {
    handlerName: "getDrivers",
    path: "drivers",
    queryType: StatisticsDriversQueryDto,
    responseType: StatisticsDriversDto,
    requiredModules: [TenantModule.TRANSPORT],
  },
  {
    handlerName: "getFinance",
    path: "finance",
    queryType: StatisticsFinanceQueryDto,
    responseType: StatisticsFinanceDto,
    requiredModules: [TenantModule.FINANCE],
  },
  {
    handlerName: "getExceptions",
    path: "exceptions",
    queryType: StatisticsExceptionsQueryDto,
    responseType: StatisticsExceptionsDto,
    requiredModules: [TenantModule.TRANSPORT, TenantModule.FINANCE],
  },
];

function handler(name: StatisticsHandlerName) {
  return StatisticsController.prototype[name];
}

function contextFor(
  name: StatisticsHandlerName,
  request: Record<string, unknown>,
) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler(name),
    getClass: () => StatisticsController,
  } as any;
}

describe("StatisticsModule", () => {
  it("compiles as a dedicated backend module", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), StatisticsModule],
    }).compile();
    expect(moduleRef.get(StatisticsModule)).toBeInstanceOf(StatisticsModule);
    await moduleRef.close();
  });

  it("is registered in AppModule without modifying DashboardModule", () => {
    const source = readFileSync(join(__dirname, "..", "app.module.ts"), "utf8");
    expect(source).toContain(
      'import { StatisticsModule } from "./statistics/statistics.module";',
    );
    expect(source).toMatch(/imports:\s*\[[\s\S]*StatisticsModule,[\s\S]*\]/);
  });

  it("registers only the truthful WP3-WP6 controllers", () => {
    const controllers =
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, StatisticsModule) ?? [];
    expect(controllers).not.toContain(StatisticsController);
    expect(controllers).toEqual([
      StatisticsOverviewController,
      StatisticsDriversController,
      StatisticsFinanceController,
      StatisticsExceptionsController,
      StatisticsTruckingController,
      StatisticsExportController,
    ]);
  });
});

describe("StatisticsController route contracts", () => {
  it("uses the stable controller prefix", () => {
    expect(Reflect.getMetadata(PATH_METADATA, StatisticsController)).toBe(
      "statistics",
    );
  });

  it.each(ROUTES)(
    "reserves GET /api/statistics/$path with its WP1 query and response DTO",
    ({ handlerName, path, queryType, responseType }) => {
      const routeHandler = handler(handlerName);
      expect(Reflect.getMetadata(PATH_METADATA, routeHandler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, routeHandler)).toBe(
        RequestMethod.GET,
      );

      const parameterTypes =
        Reflect.getMetadata(
          "design:paramtypes",
          StatisticsController.prototype,
          handlerName,
        ) ?? [];
      expect(parameterTypes[1]).toBe(queryType);

      const responses =
        Reflect.getMetadata("swagger/apiResponse", routeHandler) ?? {};
      expect(responses["200"]?.type).toBe(responseType);
    },
  );

  it("applies the strongest reporting guard stack", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, StatisticsController)).toEqual([
      AuthGuard,
      TenantGuard,
      RoleGuard,
      ModuleEntitlementGuard,
    ]);
  });

  it("allows only Tenant Admin at the controller boundary", () => {
    expect(Reflect.getMetadata("roles", StatisticsController)).toEqual([
      Role.ADMIN,
    ]);
  });

  it.each(ROUTES)(
    "requires $requiredModules for $path",
    ({ handlerName, requiredModules }) => {
      const reflector = new Reflector();
      expect(
        reflector.getAllAndOverride<TenantModule[]>(
          REQUIRES_TENANT_MODULE_KEY,
          [handler(handlerName), StatisticsController],
        ),
      ).toEqual(requiredModules);
    },
  );

  it("takes tenantId from guarded request context, never query input", () => {
    const controller = new StatisticsController();
    const deferred = jest
      .spyOn(controller as any, "deferred")
      .mockImplementation(() => {
        throw new Error("deferred-test-sentinel");
      });
    const query = Object.assign(new StatisticsFiltersQueryDto(), {
      tenantId: "untrusted-tenant",
    });

    expect(() =>
      controller.getOverview(
        {
          tenant: {
            tenantId: "trusted-tenant",
            role: Role.TRANSPORT_STAFF,
          },
        },
        query,
      ),
    ).toThrow("deferred-test-sentinel");
    expect(deferred).toHaveBeenCalledWith("overview", "trusted-tenant", query);
    expect("tenantId" in new StatisticsFiltersQueryDto()).toBe(false);
  });
});

describe("StatisticsController authorization behavior", () => {
  const reflector = new Reflector();
  const roleGuard = new RoleGuard(reflector);

  async function expectAuthorized(
    handlerName: StatisticsHandlerName,
    role: Role,
    enabledModules: TenantModule[],
  ) {
    const request = {
      tenant: { tenantId: "tenant-1", role },
    };
    const context = contextFor(handlerName, request);
    expect(roleGuard.canActivate(context)).toBe(true);

    const prisma = {
      tenantModuleEntitlement: {
        findUnique: jest.fn(
          async ({
            where,
          }: {
            where: {
              tenantId_module: {
                tenantId: string;
                module: TenantModule;
              };
            };
          }) => ({
            enabled: enabledModules.includes(where.tenantId_module.module),
          }),
        ),
      },
    };
    const entitlementGuard = new ModuleEntitlementGuard(
      prisma as any,
      reflector,
    );
    await expect(entitlementGuard.canActivate(context)).resolves.toBe(true);
  }

  it.each(["getOverview", "getDrivers"] as StatisticsHandlerName[])(
    "allows Tenant Admin on %s",
    async (handlerName) => {
      await expectAuthorized(handlerName, Role.ADMIN, [
        TenantModule.TRANSPORT,
      ]);
    },
  );

  it("requires both Transport and Finance for Exceptions", async () => {
    await expectAuthorized("getExceptions", Role.ADMIN, [
      TenantModule.TRANSPORT,
      TenantModule.FINANCE,
    ]);
  });

  it("allows Tenant Admin on Finance only when Finance is entitled", async () => {
    await expectAuthorized("getFinance", Role.ADMIN, [TenantModule.FINANCE]);
  });

  it.each([
    Role.DRIVER,
    Role.CUSTOMER,
    Role.WAREHOUSE,
    Role.TRANSPORT_STAFF,
    Role.FINANCE,
  ])(
    "denies non-tenant-admin role %s",
    (role) => {
      expect(() =>
        roleGuard.canActivate(
          contextFor("getOverview", {
            tenant: { tenantId: "tenant-1", role },
          }),
        ),
      ).toThrow(ForbiddenException);
    },
  );

  it("denies missing module entitlement", async () => {
    const guard = new ModuleEntitlementGuard(
      {
        tenantModuleEntitlement: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      } as any,
      reflector,
    );
    await expect(
      guard.canActivate(
        contextFor("getOverview", {
          tenant: {
            tenantId: "tenant-1",
            role: Role.TRANSPORT_STAFF,
          },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("denies Finance values to Transport-only entitlement", async () => {
    const guard = new ModuleEntitlementGuard(
      {
        tenantModuleEntitlement: {
          findUnique: jest.fn().mockResolvedValue({ enabled: false }),
        },
      } as any,
      reflector,
    );
    await expect(
      guard.canActivate(
        contextFor("getFinance", {
          tenant: {
            tenantId: "tenant-1",
            role: Role.TRANSPORT_STAFF,
          },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("denies requests without tenant context", async () => {
    expect(() => roleGuard.canActivate(contextFor("getOverview", {}))).toThrow(
      ForbiddenException,
    );

    const entitlementGuard = new ModuleEntitlementGuard(
      { tenantModuleEntitlement: { findUnique: jest.fn() } } as any,
      reflector,
    );
    await expect(
      entitlementGuard.canActivate(contextFor("getOverview", {})),
    ).rejects.toThrow(ForbiddenException);
  });

  it("denies unauthenticated requests through the real AuthGuard", async () => {
    const authGuard = new AuthGuard({
      verifyToken: jest.fn(),
    } as any);
    await expect(
      authGuard.canActivate(contextFor("getOverview", { headers: {} })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("keeps the reserved aggregate controller unregistered", () => {
    const registered =
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, StatisticsModule) ?? [];
    expect(registered).not.toContain(StatisticsController);
    expect(registered).toEqual([
      StatisticsOverviewController,
      StatisticsDriversController,
      StatisticsFinanceController,
      StatisticsExceptionsController,
      StatisticsTruckingController,
      StatisticsExportController,
    ]);
  });
});

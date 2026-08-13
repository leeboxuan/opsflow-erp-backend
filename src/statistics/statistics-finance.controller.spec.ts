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
import { StatisticsFinanceDto, StatisticsFinanceQueryDto } from "./dto";
import { StatisticsController } from "./statistics.controller";
import { StatisticsDriversController } from "./statistics-drivers.controller";
import { StatisticsExceptionsController } from "./statistics-exceptions.controller";
import { StatisticsExportController } from "./statistics-export.controller";
import { StatisticsFinanceController } from "./statistics-finance.controller";
import { StatisticsFinanceService } from "./statistics-finance.service";
import { StatisticsModule } from "./statistics.module";
import { StatisticsOverviewController } from "./statistics-overview.controller";
import { StatisticsTruckingController } from "./statistics-trucking.controller";

describe("StatisticsFinanceController", () => {
  const routeHandler = StatisticsFinanceController.prototype.getFinance;

  it("registers Finance beside the truthful operational controllers", () => {
    const controllers =
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, StatisticsModule) ?? [];
    expect(controllers).toEqual([
      StatisticsOverviewController,
      StatisticsDriversController,
      StatisticsFinanceController,
      StatisticsExceptionsController,
      StatisticsTruckingController,
      StatisticsExportController,
    ]);
    expect(controllers).not.toContain(StatisticsController);
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, StatisticsModule),
    ).toContain(StatisticsFinanceService);
  });

  it("registers GET /api/statistics/finance with WP1 DTOs", () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, StatisticsFinanceController),
    ).toBe("statistics");
    expect(Reflect.getMetadata(PATH_METADATA, routeHandler)).toBe("finance");
    expect(Reflect.getMetadata(METHOD_METADATA, routeHandler)).toBe(
      RequestMethod.GET,
    );
    const parameterTypes =
      Reflect.getMetadata(
        "design:paramtypes",
        StatisticsFinanceController.prototype,
        "getFinance",
      ) ?? [];
    expect(parameterTypes[1]).toBe(StatisticsFinanceQueryDto);
    const responses =
      Reflect.getMetadata("swagger/apiResponse", routeHandler) ?? {};
    expect(responses["200"]?.type).toBe(StatisticsFinanceDto);
  });

  it("uses the complete guard stack and Finance entitlement", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, StatisticsFinanceController),
    ).toEqual([AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard]);
    expect(Reflect.getMetadata("roles", StatisticsFinanceController)).toEqual([
      Role.ADMIN,
      Role.TRANSPORT_STAFF,
      Role.FINANCE,
    ]);
    const reflector = new Reflector();
    expect(
      reflector.getAllAndOverride<TenantModule[]>(REQUIRES_TENANT_MODULE_KEY, [
        routeHandler,
        StatisticsFinanceController,
      ]),
    ).toEqual([TenantModule.FINANCE]);
  });

  it("forwards only guarded tenant identity and the validated query", async () => {
    const response: StatisticsFinanceDto = {
      currencyGroups: [],
      exceptionCounts: {
        completedJobsMissingCharges: 0,
        completedTripsMissingPayouts: 0,
        excludedFromProfit: 0,
      },
      timeZone: "Asia/Singapore",
      generatedAt: new Date(),
      limitations: [],
    };
    const service = {
      getFinance: jest.fn().mockResolvedValue(response),
    };
    const controller = new StatisticsFinanceController(service as any);
    const financeQuery = Object.assign(new StatisticsFinanceQueryDto(), {
      jobId: "job-1",
      tenantId: "untrusted-tenant",
    });

    await expect(
      controller.getFinance(
        {
          tenant: {
            tenantId: "trusted-tenant",
            role: Role.FINANCE,
          },
        },
        financeQuery,
      ),
    ).resolves.toBe(response);
    expect(service.getFinance).toHaveBeenCalledWith(
      "trusted-tenant",
      financeQuery,
    );
  });

  it("denies non-reporting roles and Transport-only entitlement", async () => {
    const reflector = new Reflector();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          tenant: {
            tenantId: "tenant-1",
            role: Role.DRIVER,
          },
        }),
      }),
      getHandler: () => routeHandler,
      getClass: () => StatisticsFinanceController,
    } as any;
    expect(() => new RoleGuard(reflector).canActivate(context)).toThrow(
      ForbiddenException,
    );

    const financeContext = {
      ...context,
      switchToHttp: () => ({
        getRequest: () => ({
          tenant: {
            tenantId: "tenant-1",
            role: Role.FINANCE,
          },
        }),
      }),
    } as any;
    const findUnique = jest.fn().mockResolvedValue(null);
    const entitlementGuard = new ModuleEntitlementGuard(
      {
        tenantModuleEntitlement: { findUnique },
      } as any,
      reflector,
    );
    await expect(entitlementGuard.canActivate(financeContext)).rejects.toThrow(
      ForbiddenException,
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_module: {
          tenantId: "tenant-1",
          module: TenantModule.FINANCE,
        },
      },
      select: { enabled: true },
    });
  });
});

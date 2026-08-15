import { RequestMethod } from "@nestjs/common";
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
import { StatisticsDriversDto, StatisticsDriversQueryDto } from "./dto";
import { StatisticsController } from "./statistics.controller";
import { StatisticsDriversController } from "./statistics-drivers.controller";
import { StatisticsDriversService } from "./statistics-drivers.service";
import { StatisticsExceptionsController } from "./statistics-exceptions.controller";
import { StatisticsExportController } from "./statistics-export.controller";
import { StatisticsFinanceController } from "./statistics-finance.controller";
import { StatisticsModule } from "./statistics.module";
import { StatisticsOverviewController } from "./statistics-overview.controller";
import { StatisticsTruckingController } from "./statistics-trucking.controller";

describe("StatisticsDriversController", () => {
  const routeHandler = StatisticsDriversController.prototype.getDrivers;

  it("keeps Drivers registered beside the truthful WP5 controllers", () => {
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
    ).toContain(StatisticsDriversService);
  });

  it("registers GET /api/statistics/drivers with WP1 DTOs", () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, StatisticsDriversController),
    ).toBe("statistics");
    expect(Reflect.getMetadata(PATH_METADATA, routeHandler)).toBe("drivers");
    expect(Reflect.getMetadata(METHOD_METADATA, routeHandler)).toBe(
      RequestMethod.GET,
    );
    const parameterTypes =
      Reflect.getMetadata(
        "design:paramtypes",
        StatisticsDriversController.prototype,
        "getDrivers",
      ) ?? [];
    expect(parameterTypes[1]).toBe(StatisticsDriversQueryDto);
    const responses =
      Reflect.getMetadata("swagger/apiResponse", routeHandler) ?? {};
    expect(responses["200"]?.type).toBe(StatisticsDriversDto);
  });

  it("preserves the strongest Transport reporting authorization", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, StatisticsDriversController),
    ).toEqual([AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard]);
    expect(Reflect.getMetadata("roles", StatisticsDriversController)).toEqual([
      Role.ADMIN,
    ]);
    const reflector = new Reflector();
    expect(
      reflector.getAllAndOverride<TenantModule[]>(REQUIRES_TENANT_MODULE_KEY, [
        routeHandler,
        StatisticsDriversController,
      ]),
    ).toEqual([TenantModule.TRANSPORT]);
  });

  it("forwards only guarded tenant identity and the validated query", async () => {
    const response: StatisticsDriversDto = {
      data: [],
      meta: { page: 1, pageSize: 20, total: 0 },
      timeZone: "Asia/Singapore",
      generatedAt: new Date(),
      limitations: [],
    };
    const service = {
      getDrivers: jest.fn().mockResolvedValue(response),
    };
    const controller = new StatisticsDriversController(service as any);
    const query = Object.assign(new StatisticsDriversQueryDto(), {
      driverId: "driver-1",
      tenantId: "untrusted-tenant",
    });

    await expect(
      controller.getDrivers(
        {
          tenant: {
            tenantId: "trusted-tenant",
            role: Role.TRANSPORT_STAFF,
          },
        },
        query,
      ),
    ).resolves.toBe(response);
    expect(service.getDrivers).toHaveBeenCalledWith("trusted-tenant", query);
  });

  it("exposes no financial response fields in Swagger DTOs", () => {
    const dto = new StatisticsDriversDto();
    expect(dto).not.toHaveProperty("currencyGroups");
    expect(JSON.stringify(dto)).not.toMatch(
      /payout|earning|charge|invoice|profit|margin/i,
    );
  });
});

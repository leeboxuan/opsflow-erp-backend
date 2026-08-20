import { INestApplication, RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Role, TenantModule } from "@prisma/client";
import request from "supertest";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import {
  ModuleEntitlementGuard,
  REQUIRES_TENANT_MODULE_KEY,
} from "../shared/auth/guards/module-entitlement.guard";
import { RoleGuard } from "../shared/auth/guards/role.guard";
import { StrictCanonicalRoleGuard } from "../shared/auth/guards/strict-canonical-role.guard";
import { TenantGuard } from "../shared/auth/guards/tenant.guard";
import {
  StatisticsDriversDto,
  StatisticsExceptionsDto,
  StatisticsFiltersQueryDto,
  StatisticsFinanceDto,
  StatisticsOverviewDto,
} from "./dto";
import { StatisticsController } from "./statistics.controller";
import { StatisticsDriversController } from "./statistics-drivers.controller";
import { StatisticsDriversService } from "./statistics-drivers.service";
import { StatisticsExceptionsController } from "./statistics-exceptions.controller";
import { StatisticsExceptionsService } from "./statistics-exceptions.service";
import { StatisticsExportController } from "./statistics-export.controller";
import { StatisticsExportService } from "./statistics-export.service";
import { StatisticsFinanceController } from "./statistics-finance.controller";
import { StatisticsFinanceService } from "./statistics-finance.service";
import { StatisticsModule } from "./statistics.module";
import { StatisticsOverviewController } from "./statistics-overview.controller";
import { StatisticsOverviewService } from "./statistics-overview.service";
import { StatisticsTruckingController } from "./statistics-trucking.controller";

describe("StatisticsOverviewController", () => {
  const routeHandler = StatisticsOverviewController.prototype.getOverview;

  it("remains registered beside all truthful Statistics controllers", () => {
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
    ).toContain(StatisticsOverviewService);
  });

  it("registers only GET /api/statistics/overview", () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, StatisticsOverviewController),
    ).toBe("statistics");
    expect(Reflect.getMetadata(PATH_METADATA, routeHandler)).toBe("overview");
    expect(Reflect.getMetadata(METHOD_METADATA, routeHandler)).toBe(
      RequestMethod.GET,
    );
    expect(StatisticsOverviewController.prototype).not.toHaveProperty(
      "getDrivers",
    );
    expect(StatisticsOverviewController.prototype).not.toHaveProperty(
      "getFinance",
    );
    expect(StatisticsOverviewController.prototype).not.toHaveProperty(
      "getExceptions",
    );
  });

  it("preserves the WP2 staff and Transport authorization policy", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, StatisticsOverviewController),
    ).toEqual([AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard]);
    expect(Reflect.getMetadata("roles", StatisticsOverviewController)).toEqual([
      Role.ADMIN,
    ]);
    const reflector = new Reflector();
    expect(
      reflector.getAllAndOverride<TenantModule[]>(REQUIRES_TENANT_MODULE_KEY, [
        routeHandler,
        StatisticsOverviewController,
      ]),
    ).toEqual([TenantModule.TRANSPORT]);
  });

  it("uses the shared query and operational Overview response DTO", () => {
    const parameterTypes =
      Reflect.getMetadata(
        "design:paramtypes",
        StatisticsOverviewController.prototype,
        "getOverview",
      ) ?? [];
    expect(parameterTypes[1]).toBe(StatisticsFiltersQueryDto);
    const responses =
      Reflect.getMetadata("swagger/apiResponse", routeHandler) ?? {};
    expect(responses["200"]?.type).toBe(StatisticsOverviewDto);
  });

  it("forwards only guarded tenant identity and the validated query", async () => {
    const result: StatisticsOverviewDto = {
      timeZone: "Asia/Singapore",
      generatedAt: new Date(),
      limitations: [],
      completedTrips: 1,
      operationallyCompletedJobs: 1,
      activePendingTrips: 0,
      cancelledTrips: 0,
      uniqueContainers: 0,
      containerMovements: 0,
    };
    const overviewService = {
      getOverview: jest.fn().mockResolvedValue(result),
    };
    const controller = new StatisticsOverviewController(overviewService as any);
    const filters = Object.assign(new StatisticsFiltersQueryDto(), {
      jobId: "job-1",
      tenantId: "untrusted-tenant",
    });

    await expect(
      controller.getOverview(
        {
          tenant: {
            tenantId: "trusted-tenant",
            role: Role.TRANSPORT_STAFF,
          },
        },
        filters,
      ),
    ).resolves.toBe(result);
    expect(overviewService.getOverview).toHaveBeenCalledWith(
      "trusted-tenant",
      filters,
    );
  });

  it("cannot expose finance fields through the operational response contract", () => {
    const dto = new StatisticsOverviewDto();
    expect(dto).not.toHaveProperty("currencyGroups");
    expect(dto).not.toHaveProperty("missingCostCount");
  });
});

describe("Statistics WP6 HTTP reachability", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const result: StatisticsOverviewDto = {
      timeZone: "Asia/Singapore",
      generatedAt: new Date("2026-08-05T00:00:00.000Z"),
      limitations: [],
      completedTrips: 1,
      operationallyCompletedJobs: 1,
      activePendingTrips: 2,
      cancelledTrips: 0,
      uniqueContainers: 0,
      containerMovements: 0,
    };
    const driversResult: StatisticsDriversDto = {
      data: [],
      meta: { page: 1, pageSize: 20, total: 0 },
      timeZone: "Asia/Singapore",
      generatedAt: new Date("2026-08-05T00:00:00.000Z"),
      limitations: [],
    };
    const financeResult: StatisticsFinanceDto = {
      currencyGroups: [],
      exceptionCounts: {
        completedJobsMissingCharges: 0,
        completedTripsMissingPayouts: 0,
        excludedFromProfit: 0,
      },
      negativeJobCount: 0,
      timeZone: "Asia/Singapore",
      generatedAt: new Date("2026-08-05T00:00:00.000Z"),
      limitations: [],
    };
    const exceptionsResult: StatisticsExceptionsDto = {
      data: [],
      meta: { page: 1, pageSize: 20, total: 0 },
      countsByKey: [],
      timeZone: "Asia/Singapore",
      generatedAt: new Date("2026-08-05T00:00:00.000Z"),
      limitations: [],
    };
    const tenantGuard = {
      canActivate: (context: any) => {
        context.switchToHttp().getRequest().tenant = {
          tenantId: "tenant-1",
          role: Role.TRANSPORT_STAFF,
        };
        return true;
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [
        StatisticsOverviewController,
        StatisticsDriversController,
        StatisticsFinanceController,
        StatisticsExceptionsController,
        StatisticsExportController,
      ],
      providers: [
        {
          provide: StatisticsOverviewService,
          useValue: { getOverview: jest.fn().mockResolvedValue(result) },
        },
        {
          provide: StatisticsDriversService,
          useValue: {
            getDrivers: jest.fn().mockResolvedValue(driversResult),
          },
        },
        {
          provide: StatisticsFinanceService,
          useValue: {
            getFinance: jest.fn().mockResolvedValue(financeResult),
          },
        },
        {
          provide: StatisticsExceptionsService,
          useValue: {
            getExceptions: jest.fn().mockResolvedValue(exceptionsResult),
          },
        },
        {
          provide: StatisticsExportService,
          useValue: {
            exportDrivers: jest.fn().mockResolvedValue({
              body: Buffer.from("\uFEFFdrivers"),
              filename: "drivers.csv",
              rowCount: 0,
            }),
            exportFinance: jest.fn().mockResolvedValue({
              body: Buffer.from("\uFEFFfinance"),
              filename: "finance.csv",
              rowCount: 0,
            }),
            exportExceptions: jest.fn().mockResolvedValue({
              body: Buffer.from("\uFEFFexceptions"),
              filename: "exceptions.csv",
              rowCount: 0,
            }),
          },
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TenantGuard)
      .useValue(tenantGuard)
      .overrideGuard(RoleGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(StrictCanonicalRoleGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ModuleEntitlementGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("reaches all truthful Statistics routes", async () => {
    await request(app.getHttpServer())
      .get("/api/statistics/overview")
      .expect(200)
      .expect(({ body }) => {
        expect(body.completedTrips).toBe(1);
        expect(body).not.toHaveProperty("currencyGroups");
      });
    await request(app.getHttpServer())
      .get("/api/statistics/drivers")
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual([]);
        expect(body).not.toHaveProperty("currencyGroups");
      });
    await request(app.getHttpServer())
      .get("/api/statistics/finance")
      .expect(200)
      .expect(({ body }) => {
        expect(body.currencyGroups).toEqual([]);
        expect(body.exceptionCounts.excludedFromProfit).toBe(0);
      });
    await request(app.getHttpServer())
      .get("/api/statistics/exceptions")
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual([]);
        expect(body).not.toHaveProperty("currencyGroups");
      });
    for (const view of ["drivers", "finance", "exceptions"]) {
      await request(app.getHttpServer())
        .get(`/api/statistics/${view}/export`)
        .expect(200)
        .expect(
          "Content-Type",
          /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
        );
    }
  });
});

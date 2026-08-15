import { RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
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
  StatisticsDriverRowDto,
  StatisticsDriversDto,
  StatisticsExceptionItemDto,
  StatisticsExceptionsDto,
  StatisticsFinanceDto,
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
import { buildDriverAggregateSql } from "./statistics-drivers.service";
import { StatisticsDriversQueryDto } from "./dto";
import { STATISTICS_DRIVER_SORT_FIELDS } from "./statistics.constants";

function readStatisticsSource(fileName: string): string {
  return readFileSync(join(__dirname, fileName), "utf8");
}

const FINANCIAL_LEAK_PATTERNS = [
  "currencyGroups",
  "jobChargesCents",
  "issuedInvoiceValueCents",
  "paidInvoiceValueCents",
  "recordedTripPayoutCents",
  "grossProfitCents",
  "grossMarginBasisPoints",
  "driverEarningCents",
  "recordedPayoutCents",
];

describe("Statistics V1 security and integration audit", () => {
  describe("route registration and guard matrix", () => {
    const registered =
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, StatisticsModule) ?? [];

    it("registers the truthful controllers and not the reserved stub", () => {
      expect(registered).toEqual([
        StatisticsOverviewController,
        StatisticsDriversController,
        StatisticsFinanceController,
        StatisticsExceptionsController,
        StatisticsTruckingController,
        StatisticsExportController,
      ]);
      expect(registered).not.toContain(StatisticsController);
    });

    it.each([
      [
        "overview",
        StatisticsOverviewController,
        StatisticsOverviewController.prototype.getOverview,
        [TenantModule.TRANSPORT],
      ],
      [
        "drivers",
        StatisticsDriversController,
        StatisticsDriversController.prototype.getDrivers,
        [TenantModule.TRANSPORT],
      ],
      [
        "finance",
        StatisticsFinanceController,
        StatisticsFinanceController.prototype.getFinance,
        [TenantModule.FINANCE],
      ],
      [
        "exceptions",
        StatisticsExceptionsController,
        StatisticsExceptionsController.prototype.getExceptions,
        [TenantModule.TRANSPORT, TenantModule.FINANCE],
      ],
    ] as const)(
      "applies Auth→Tenant→Role→Module and %s entitlement",
      (_path, controller, handler, modules) => {
        expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([
          AuthGuard,
          TenantGuard,
          RoleGuard,
          ModuleEntitlementGuard,
        ]);
        expect(Reflect.getMetadata("roles", controller)).toEqual([
          Role.ADMIN,
        ]);
        expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(_path);
        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
          RequestMethod.GET,
        );
        const reflector = new Reflector();
        expect(
          reflector.getAllAndOverride<TenantModule[]>(
            REQUIRES_TENANT_MODULE_KEY,
            [handler, controller],
          ),
        ).toEqual([...modules]);
      },
    );

    it("keeps controllers free of aggregation logic", () => {
      for (const file of [
        "statistics-overview.controller.ts",
        "statistics-drivers.controller.ts",
        "statistics-finance.controller.ts",
        "statistics-exceptions.controller.ts",
        "statistics-trucking.controller.ts",
      ]) {
        const source = readStatisticsSource(file);
        expect(source).toMatch(/req\.tenant\.tenantId/);
        expect(source).not.toContain("prisma.");
        expect(source).not.toContain("$queryRaw");
        expect(source).not.toContain("groupBy");
        expect(source).not.toContain("evaluateGrossProfitEligibility");
      }
    });
  });

  describe("financial isolation of operational surfaces", () => {
    it("keeps Overview, Drivers, and Exceptions DTOs financially sterile", () => {
      for (const dto of [
        new StatisticsOverviewDto(),
        new StatisticsDriversDto(),
        new StatisticsDriverRowDto(),
        new StatisticsExceptionsDto(),
        new StatisticsExceptionItemDto(),
      ]) {
        for (const key of FINANCIAL_LEAK_PATTERNS) {
          expect(dto).not.toHaveProperty(key);
        }
      }
      expect(new StatisticsFinanceDto()).toHaveProperty("currencyGroups");
    });

    it("keeps Driver sort allowlist free of recordedPayoutCents", () => {
      expect(STATISTICS_DRIVER_SORT_FIELDS).toEqual([
        "completedTrips",
        "avgDurationMs",
      ]);
      expect(STATISTICS_DRIVER_SORT_FIELDS).not.toContain(
        "recordedPayoutCents",
      );
    });

    it("keeps Overview and Drivers services free of finance queries", () => {
      for (const file of [
        "statistics-overview.service.ts",
        "statistics-drivers.service.ts",
      ]) {
        const source = readStatisticsSource(file);
        expect(source).not.toContain("jobCharge");
        expect(source).not.toContain("tripPayoutLine");
        expect(source).not.toContain("invoice");
        expect(source).not.toContain("driverEarningCents");
        expect(source).not.toContain("currencyGroups");
      }
    });

    it("keeps Exceptions responses free of monetary fields while allowing internal eligibility predicates", () => {
      const source = readStatisticsSource("statistics-exceptions.service.ts");
      expect(source).not.toContain("currencyGroups");
      expect(source).not.toContain("jobChargesCents");
      expect(source).not.toContain("grossProfitCents");
      expect(source).not.toContain("driverEarningCents");
      expect(source).toContain("evaluateGrossProfitEligibility");
      expect(source).toContain("tripPayoutLine");
      expect(source).toContain("jobCharge");
    });
  });

  describe("raw-SQL boundary", () => {
    it("confines $queryRaw to Drivers and forbids Unsafe everywhere", () => {
      const drivers = readStatisticsSource("statistics-drivers.service.ts");
      expect(drivers).toContain("$queryRaw");
      expect(drivers).not.toContain("$queryRawUnsafe");
      for (const file of [
        "statistics-overview.service.ts",
        "statistics-finance.service.ts",
        "statistics-exceptions.service.ts",
        "statistics-trucking.service.ts",
      ]) {
        const source = readStatisticsSource(file);
        expect(source).not.toContain("$queryRaw");
        expect(source).not.toContain("$queryRawUnsafe");
      }
    });

    it("keeps tenant scope mandatory and sort fragments trusted under adversarial input", () => {
      const malicious = 'avgDurationMs"; DROP TABLE "trips"; --';
      const statement = buildDriverAggregateSql({
        tenantId: "tenant-1",
        query: Object.assign(new StatisticsDriversQueryDto(), {
          from: "2026-08-01",
          to: "2026-08-01",
          sortBy: malicious as never,
          sortDir: malicious as never,
          customerId: "customer'; DROP TABLE x; --",
        }),
        range: {
          gte: new Date("2026-07-31T16:00:00.000Z"),
          lt: new Date("2026-08-01T16:00:00.000Z"),
        },
        skip: 0,
        take: 20,
      });
      const text = statement.sql.replace(/\s+/g, " ");
      expect(text).toContain('t."tenantId" = ?');
      expect(text).toContain('j."tenantId" = ?');
      expect(text).toContain('r."completedTrips" DESC');
      expect(text).not.toContain("DROP TABLE");
      expect(statement.values).toContain("tenant-1");
      expect(statement.values).toContain("customer'; DROP TABLE x; --");
      expect(statement.sql).not.toContain("customer'; DROP TABLE x; --");
    });
  });

  describe("tenant-scope source contracts", () => {
    it.each([
      "statistics-overview.service.ts",
      "statistics-drivers.service.ts",
      "statistics-finance.service.ts",
      "statistics-exceptions.service.ts",
      "statistics-trucking.service.ts",
      "statistics-customers.service.ts",
    ])("keeps tenantId on every primary query builder in %s", (file) => {
      const source = readStatisticsSource(file);
      expect(source).toContain("tenantId");
      expect(source).not.toMatch(
        /findMany\(\s*\{\s*where:\s*\{\s*(?![\s\S]*tenantId)/,
      );
    });

    it("groups vehicle OR under tenant-scoped trip predicates in Drivers SQL", () => {
      const statement = buildDriverAggregateSql({
        tenantId: "tenant-1",
        query: Object.assign(new StatisticsDriversQueryDto(), {
          from: "2026-08-01",
          to: "2026-08-01",
          vehicleId: "vehicle-1",
          customerId: "customer-1",
        }),
        range: {
          gte: new Date("2026-07-31T16:00:00.000Z"),
          lt: new Date("2026-08-01T16:00:00.000Z"),
        },
        skip: 0,
        take: 20,
      });
      const text = statement.sql.replace(/\s+/g, " ");
      expect(text).toContain('t."tenantId" = ?');
      expect(text).toContain('( t."vehicleId" = ? OR t."fleetVehicleId" = ? )');
      expect(statement.values).toEqual(
        expect.arrayContaining(["tenant-1", "customer-1", "vehicle-1"]),
      );
    });
  });

  describe("query-bound conventions", () => {
    it("documents batch sizes for Finance and Exceptions", () => {
      expect(readStatisticsSource("statistics-finance.service.ts")).toContain(
        "FINANCE_JOB_BATCH_SIZE = 200",
      );
      expect(
        readStatisticsSource("statistics-exceptions.service.ts"),
      ).toContain("EXCEPTION_BATCH_SIZE = 200");
      expect(readStatisticsSource("statistics-overview.service.ts")).toContain(
        "OVERVIEW_JOB_BATCH_SIZE = 200",
      );
      expect(readStatisticsSource("statistics-overview.service.ts")).toContain(
        "OVERVIEW_TRIP_BATCH_SIZE = 200",
      );
    });

    it("keeps Driver pagination in SQL rather than loading all aggregate rows", () => {
      const source = readStatisticsSource("statistics-drivers.service.ts");
      expect(source).toContain('o."pageOrder" > ${skip}');
      expect(source).toContain('o."pageOrder" <= ${pageEnd}');
      expect(source).toContain('COUNT(*)::bigint AS "totalRows"');
    });
  });
});

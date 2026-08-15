import { ValidationPipe } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { Role, TenantModule } from "@prisma/client";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import {
  ModuleEntitlementGuard,
  REQUIRES_TENANT_MODULE_KEY,
} from "../shared/auth/guards/module-entitlement.guard";
import { RoleGuard } from "../shared/auth/guards/role.guard";
import { TenantGuard } from "../shared/auth/guards/tenant.guard";
import {
  StatisticsDriversExportQueryDto,
  StatisticsExceptionsExportQueryDto,
  StatisticsFinanceExportQueryDto,
} from "./dto";
import { StatisticsExportController } from "./statistics-export.controller";

describe("StatisticsExportController", () => {
  const exportsService = {
    exportDrivers: jest.fn(),
    exportFinance: jest.fn(),
    exportExceptions: jest.fn(),
  };
  const controller = new StatisticsExportController(exportsService as any);

  beforeEach(() => jest.clearAllMocks());

  it("uses the established auth, tenant, role, and module guard stack", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, StatisticsExportController),
    ).toEqual([AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard]);
    expect(Reflect.getMetadata("roles", StatisticsExportController)).toEqual([
      Role.ADMIN,
    ]);
  });

  it.each([
    [
      "drivers/export",
      StatisticsExportController.prototype.exportDrivers,
      [TenantModule.TRANSPORT],
    ],
    [
      "finance/export",
      StatisticsExportController.prototype.exportFinance,
      [TenantModule.FINANCE],
    ],
    [
      "exceptions/export",
      StatisticsExportController.prototype.exportExceptions,
      [TenantModule.TRANSPORT, TenantModule.FINANCE],
    ],
  ] as const)(
    "registers GET %s with exact entitlements",
    (path, handler, modules) => {
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(0);
      expect(Reflect.getMetadata(REQUIRES_TENANT_MODULE_KEY, handler)).toEqual(
        modules,
      );
    },
  );

  it("uses only request tenant context and writes safe Excel headers", async () => {
    exportsService.exportDrivers.mockResolvedValue({
      body: Buffer.from("PK"),
      filename: "OpsFlow-Drivers-2026-08-01-to-2026-08-31.xlsx",
      rowCount: 0,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const response = {
      setHeader: jest.fn(),
      send: jest.fn().mockReturnThis(),
    };
    const result = await controller.exportDrivers(
      { tenant: { tenantId: "trusted-tenant", role: "ADMIN" } } as any,
      { from: "2026-08-01", to: "2026-08-31" },
      response as any,
    );

    expect(exportsService.exportDrivers).toHaveBeenCalledWith(
      "trusted-tenant",
      { from: "2026-08-01", to: "2026-08-31" },
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="OpsFlow-Drivers-2026-08-01-to-2026-08-31.xlsx"',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Content-Type-Options",
      "nosniff",
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store",
    );
    expect(response.send).toHaveBeenCalledWith(Buffer.from("PK"));
    expect(result).toBe(response);
  });

  it.each([
    StatisticsDriversExportQueryDto,
    StatisticsFinanceExportQueryDto,
    StatisticsExceptionsExportQueryDto,
  ])("rejects pagination and tenantId for %p", async (metatype) => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform(
        { page: "1", pageSize: "100", tenantId: "foreign" },
        { type: "query", metatype },
      ),
    ).rejects.toThrow();
  });
});

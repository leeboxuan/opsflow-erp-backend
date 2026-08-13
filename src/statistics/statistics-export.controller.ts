import { Controller, Get, Query, Req, Res, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from "@nestjs/swagger";
import { Role, TenantModule } from "@prisma/client";
import type { Response } from "express";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../shared/auth/guards/module-entitlement.guard";
import { RoleGuard, Roles } from "../shared/auth/guards/role.guard";
import { TenantGuard } from "../shared/auth/guards/tenant.guard";
import {
  StatisticsDriversExportQueryDto,
  StatisticsExceptionsExportQueryDto,
  StatisticsFiltersQueryDto,
  StatisticsFinanceExportQueryDto,
} from "./dto";
import {
  StatisticsExportService,
  type StatisticsFileExport,
} from "./statistics-export.service";
import { StatisticsTenantRequest } from "./statistics.controller";

@ApiTags("Statistics")
@Controller("statistics")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
@ApiBearerAuth("JWT-auth")
export class StatisticsExportController {
  constructor(private readonly exports: StatisticsExportService) {}

  @Get("drivers/export")
  @RequiresTenantModule(TenantModule.TRANSPORT)
  @ApiOperation({ summary: "Export Driver Statistics Excel" })
  @ApiProduces("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  async exportDrivers(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsDriversExportQueryDto,
    @Res() response: Response,
  ): Promise<Response> {
    return this.send(
      response,
      await this.exports.exportDrivers(req.tenant.tenantId, query),
    );
  }

  @Get("finance/export")
  @RequiresTenantModule(TenantModule.FINANCE)
  @ApiOperation({ summary: "Export Finance Statistics Excel" })
  @ApiProduces("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  async exportFinance(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsFinanceExportQueryDto,
    @Res() response: Response,
  ): Promise<Response> {
    return this.send(
      response,
      await this.exports.exportFinance(req.tenant.tenantId, query),
    );
  }

  @Get("exceptions/export")
  @RequiresTenantModule(TenantModule.TRANSPORT, TenantModule.FINANCE)
  @ApiOperation({ summary: "Export Exceptions Statistics Excel" })
  @ApiProduces("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  async exportExceptions(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsExceptionsExportQueryDto,
    @Res() response: Response,
  ): Promise<Response> {
    return this.send(
      response,
      await this.exports.exportExceptions(req.tenant.tenantId, query),
    );
  }

  @Get("trucking/export")
  @RequiresTenantModule(TenantModule.TRANSPORT)
  @ApiOperation({ summary: "Export Trucking Statistics Excel" })
  @ApiProduces("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  async exportTrucking(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsFiltersQueryDto,
    @Res() response: Response,
  ): Promise<Response> {
    return this.send(
      response,
      await this.exports.exportTrucking(req.tenant.tenantId, query),
    );
  }

  @Get("customers/export")
  @RequiresTenantModule(TenantModule.TRANSPORT)
  @ApiOperation({ summary: "Export Customer Statistics Excel" })
  @ApiProduces("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  async exportCustomers(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsFiltersQueryDto,
    @Res() response: Response,
  ): Promise<Response> {
    return this.send(
      response,
      await this.exports.exportCustomers(req.tenant.tenantId, query),
    );
  }

  @Get("export")
  @RequiresTenantModule(TenantModule.TRANSPORT)
  @ApiOperation({ summary: "Export full management Statistics workbook" })
  @ApiProduces("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  async exportManagement(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsFiltersQueryDto,
    @Res() response: Response,
  ): Promise<Response> {
    return this.send(
      response,
      await this.exports.exportManagement(req.tenant.tenantId, query),
    );
  }

  private send(response: Response, result: StatisticsFileExport): Response {
    response.setHeader(
      "Content-Type",
      result.contentType ||
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`,
    );
    response.setHeader("Content-Length", result.body.length);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    return response.send(result.body);
  }
}

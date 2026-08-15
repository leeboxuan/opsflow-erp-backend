import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Role, TenantModule } from "@prisma/client";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../shared/auth/guards/module-entitlement.guard";
import { RoleGuard, Roles } from "../shared/auth/guards/role.guard";
import { TenantGuard } from "../shared/auth/guards/tenant.guard";
import { StatisticsDriversDto, StatisticsDriversQueryDto } from "./dto";
import { StatisticsTenantRequest } from "./statistics.controller";
import { StatisticsDriversService } from "./statistics-drivers.service";

@ApiTags("Statistics")
@Controller("statistics")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.TRANSPORT)
@Roles(Role.ADMIN)
@ApiBearerAuth("JWT-auth")
export class StatisticsDriversController {
  constructor(
    private readonly driversService: StatisticsDriversService,
  ) {}

  @Get("drivers")
  @ApiOperation({ summary: "Get operational Statistics V1 driver metrics" })
  @ApiOkResponse({ type: StatisticsDriversDto })
  getDrivers(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsDriversQueryDto,
  ): Promise<StatisticsDriversDto> {
    return this.driversService.getDrivers(req.tenant.tenantId, query);
  }
}

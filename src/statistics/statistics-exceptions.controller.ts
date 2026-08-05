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
import {
  StatisticsExceptionsDto,
  StatisticsExceptionsQueryDto,
} from "./dto";
import { StatisticsTenantRequest } from "./statistics.controller";
import { StatisticsExceptionsService } from "./statistics-exceptions.service";

@ApiTags("Statistics")
@Controller("statistics")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.TRANSPORT, TenantModule.FINANCE)
@Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
@ApiBearerAuth("JWT-auth")
export class StatisticsExceptionsController {
  constructor(
    private readonly exceptionsService: StatisticsExceptionsService,
  ) {}

  @Get("exceptions")
  @ApiOperation({ summary: "Get actionable Statistics V1 exceptions" })
  @ApiOkResponse({ type: StatisticsExceptionsDto })
  getExceptions(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsExceptionsQueryDto,
  ): Promise<StatisticsExceptionsDto> {
    return this.exceptionsService.getExceptions(
      req.tenant.tenantId,
      query,
    );
  }
}

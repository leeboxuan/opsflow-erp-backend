import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import { TenantGuard } from "../shared/auth/guards/tenant.guard";
import { DashboardService } from "./dashboard.service";
import { DashboardSummaryMetaDto, DashboardSummaryQueryDto } from "./dto";

@ApiTags("Dashboard")
@ApiBearerAuth("JWT-auth")
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @UseGuards(AuthGuard, TenantGuard)
  @Get("summary")
  @ApiOperation({
    summary:
      "Tenant dashboard summary with calendar-period KPIs (legacy fields preserved)",
  })
  @ApiOkResponse({
    description:
      "Legacy dashboard aggregates plus additive timeZone/from/to/kpis metadata",
    type: DashboardSummaryMetaDto,
  })
  async getSummary(
    @Req() req: any,
    @Query() query: DashboardSummaryQueryDto,
  ) {
    const tenantId = req?.tenant?.tenantId;
    return this.dashboardService.getSummary(tenantId, query);
  }
}

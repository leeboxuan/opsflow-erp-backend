import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/guards/auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { DashboardService } from "./dashboard.service";

@ApiTags("Dashboard")
@ApiBearerAuth("JWT-auth")
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @UseGuards(AuthGuard, TenantGuard)
  @Get("summary")
  async getSummary(@Req() req: any) {
    const tenantId = req?.tenant?.tenantId;
    return this.dashboardService.getSummary(tenantId);
  }
}

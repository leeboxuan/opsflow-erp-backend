import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { AuthGuard } from "../../auth/guards/auth.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { RoleGuard, Roles } from "../../auth/guards/role.guard";
import { DriverJobsService } from "./driver-jobs.service";
import { DriverHomeQueryDto } from "./dto/driver-home-query.dto";

@ApiTags("driver-home")
@Controller("drivers")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.DRIVER)
@ApiBearerAuth("JWT-auth")
export class DriverHomeController {
  constructor(private readonly driverJobs: DriverJobsService) {}

  @Get("home")
  @ApiOperation({
    summary: "Driver mobile Home — Today's Run plus assigned work outside today",
    description:
      "Single response for mobile Home: today jobs/trips/runSheet/summary plus assignedOutsideToday (needsAttention, upcoming, unscheduled). Slim card fields only; no signed URLs or cargo items.",
  })
  async getHome(@Req() req: any, @Query() query: DriverHomeQueryDto) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.getDriverHome(tenantId, userId, query.date);
  }
}

import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { AuthGuard } from "../auth/guards/auth.guard";
import { RoleGuard, Roles } from "../auth/guards/role.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { OpsJobsService } from "./ops-jobs.service";

@ApiTags("ops-trips")
@Controller("trips")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.ADMIN, Role.OPS, Role.CUSTOMER)
@ApiBearerAuth("JWT-auth")
export class OpsTripsController {
  constructor(private readonly jobs: OpsJobsService) {}

  @Get(":tripId")
  @ApiOperation({
    summary:
      "Get full trip detail including route snapshot, payout lines, documents, requirements, and tracking",
  })
  async getTripDetail(@Req() req: any, @Param("tripId") tripId: string) {
    const tenantId = req.tenant.tenantId;
    const accessUser = {
      ...req.user,
      role: req.tenant.role,
      customerCompanyId: req.tenant.customerCompanyId,
    };
    return this.jobs.getTripDetail(tenantId, tripId, accessUser);
  }
}

import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { RoleGuard, Roles } from "../../shared/auth/guards/role.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { TransportJobsService } from "../jobs/transport-jobs.service";

@ApiTags("ops-trips")
@Controller("trips")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.CUSTOMER)
@ApiBearerAuth("JWT-auth")
export class TransportTripsController {
  constructor(private readonly jobs: TransportJobsService) {}

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

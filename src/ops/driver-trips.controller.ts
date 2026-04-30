import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { AuthGuard } from "../auth/guards/auth.guard";
import { RoleGuard, Roles } from "../auth/guards/role.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { DriverJobsService } from "./driver-jobs.service";

@ApiTags("driver-trips")
@Controller("drivers/trips")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.DRIVER)
@ApiBearerAuth("JWT-auth")
export class DriverTripsController {
  constructor(private readonly driverJobs: DriverJobsService) {}

  @Get(":tripId")
  @ApiOperation({ summary: "Get driver-scoped trip execution detail by trip id" })
  @ApiOkResponse({
    schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        jobId: { type: "string", nullable: true },
        title: { type: "string", nullable: true },
        status: { type: "string" },
        plannedStartAt: { type: "string", format: "date-time", nullable: true },
        jobSequence: { type: "number", nullable: true },
        tripSequence: { type: "number", nullable: true },
        origin: { type: "string", nullable: true },
        destination: { type: "string", nullable: true },
      },
    },
  })
  async getTrip(@Req() req: any, @Param("tripId") tripId: string) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverJobs.getTripDetailForDriver(tenantId, tripId, userId);
  }
}

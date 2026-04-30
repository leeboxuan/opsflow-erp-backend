import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { AuthGuard } from "../auth/guards/auth.guard";
import { RoleGuard, Roles } from "../auth/guards/role.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { DispatchService } from "./dispatch.service";
import { DispatchOptimiseRouteDto, DispatchReorderTripsDto } from "./dto/dispatch.dto";

@ApiTags("dispatch")
@Controller("dispatch")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.ADMIN, Role.OPS)
@ApiBearerAuth("JWT-auth")
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Get("board")
  @ApiOperation({ summary: "Get dispatch board data for tenant" })
  async board(@Req() req: any) {
    return this.dispatchService.getBoard(req.tenant.tenantId);
  }

  @Patch("drivers/:driverUserId/trips/reorder")
  @ApiOperation({ summary: "Reorder open driver trips for a day" })
  async reorderDriverTrips(
    @Req() req: any,
    @Param("driverUserId") driverUserId: string,
    @Body() dto: DispatchReorderTripsDto,
  ) {
    return this.dispatchService.reorderDriverTrips(req.tenant.tenantId, driverUserId, dto);
  }

  @Post("drivers/:driverUserId/trips/optimise-route")
  @ApiOperation({ summary: "Suggest route order using nearest-neighbour heuristic" })
  async optimiseDriverRoute(
    @Req() req: any,
    @Param("driverUserId") driverUserId: string,
    @Body() dto: DispatchOptimiseRouteDto,
  ) {
    return this.dispatchService.optimiseRoute(req.tenant.tenantId, driverUserId, dto);
  }
}

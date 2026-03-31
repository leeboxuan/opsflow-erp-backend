import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/guards/auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { VehiclesService } from "./vehicles.service";
import { ListVehiclesQueryDto } from "./dto/list-vehicles.query.dto";

/**
 * Fleet UI alias: same payload as GET /vehicles for frontend parity.
 */
@ApiTags("fleet")
@Controller("fleet")
@UseGuards(AuthGuard, TenantGuard)
@ApiBearerAuth("JWT-auth")
export class FleetController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Get()
  @ApiOperation({ summary: "List fleet vehicles (same as GET /vehicles)" })
  async list(@Req() req: any, @Query() query: ListVehiclesQueryDto) {
    const tenantId = req.tenant.tenantId;
    return this.vehiclesService.list(tenantId, query);
  }
}

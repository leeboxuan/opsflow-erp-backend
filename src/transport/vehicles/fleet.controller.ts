import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../shared/auth/guards/module-entitlement.guard";
import { TenantModule } from "@prisma/client";
import { RoleGuard, Roles } from "../../shared/auth/guards/role.guard";
import { TRANSPORT_OPS_ROLES } from "../../shared/auth/canonical-tenant-role";
import { VehiclesService } from "./vehicles.service";
import { ListVehiclesQueryDto } from "./dto/list-vehicles.query.dto";

/**
 * Fleet UI alias: same payload as GET /vehicles for frontend parity.
 */
@ApiTags("fleet")
@Controller("fleet")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.TRANSPORT)
@Roles(...TRANSPORT_OPS_ROLES)
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

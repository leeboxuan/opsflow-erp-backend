import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Role, TenantModule } from "@prisma/client";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../shared/auth/guards/module-entitlement.guard";
import { RoleGuard, Roles } from "../../shared/auth/guards/role.guard";
import { AccessSurface } from "../../shared/auth/guards/access-surface.guard";
import { DriverJobsService } from "./driver-jobs.service";
import { ListDriverChassisOptionsQueryDto } from "./dto/list-driver-chassis-options-query.dto";

@ApiTags("driver-chassis")
@Controller("drivers/chassis")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.TRANSPORT)
@Roles(Role.DRIVER)
@AccessSurface("driver")
@ApiBearerAuth("JWT-auth")
export class DriverChassisController {
  constructor(private readonly driverJobs: DriverJobsService) {}

  @Get("options")
  @ApiOperation({
    summary:
      "Tenant-scoped chassis selector for trailer check-in (ACTIVE only; excludes inactive)",
  })
  listOptions(@Req() req: any, @Query() query: ListDriverChassisOptionsQueryDto) {
    return this.driverJobs.listChassisOptionsForDriver(
      req.tenant.tenantId,
      query,
    );
  }
}

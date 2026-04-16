import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/guards/auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { AssignFleetVehicleDriverDto } from "./dto/assign-fleet-vehicle-driver.dto";
import { CreateFleetVehicleDto } from "./dto/create-fleet-vehicle.dto";
import { ListFleetVehiclesQueryDto } from "./dto/list-fleet-vehicles.query.dto";
import { UpdateFleetVehicleDto } from "./dto/update-fleet-vehicle.dto";
import { FleetVehiclesService } from "./fleet-vehicles.service";

@ApiTags("fleet-vehicles")
@Controller("fleet-vehicles")
@UseGuards(AuthGuard, TenantGuard)
@ApiBearerAuth("JWT-auth")
export class FleetVehiclesController {
  constructor(private readonly fleetVehiclesService: FleetVehiclesService) {}

  @Post()
  @ApiOperation({ summary: "Create a fleet vehicle (tenant-scoped)" })
  async create(@Req() req: any, @Body() dto: CreateFleetVehicleDto) {
    return this.fleetVehiclesService.create(req.tenant.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: "List fleet vehicles with filters and pagination" })
  async list(@Req() req: any, @Query() query: ListFleetVehiclesQueryDto) {
    return this.fleetVehiclesService.list(req.tenant.tenantId, query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get fleet vehicle by id" })
  async getById(@Req() req: any, @Param("id") id: string) {
    return this.fleetVehiclesService.getById(req.tenant.tenantId, id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update fleet vehicle" })
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: UpdateFleetVehicleDto,
  ) {
    return this.fleetVehiclesService.update(req.tenant.tenantId, id, dto);
  }

  @Post(":id/suspend")
  @ApiOperation({ summary: "Set fleet vehicle status to INACTIVE" })
  async suspend(@Req() req: any, @Param("id") id: string) {
    return this.fleetVehiclesService.suspend(req.tenant.tenantId, id);
  }

  @Post(":id/unsuspend")
  @ApiOperation({ summary: "Set fleet vehicle status to ACTIVE" })
  async unsuspend(@Req() req: any, @Param("id") id: string) {
    return this.fleetVehiclesService.unsuspend(req.tenant.tenantId, id);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete fleet vehicle (hard delete)" })
  async delete(@Req() req: any, @Param("id") id: string) {
    return this.fleetVehiclesService.delete(req.tenant.tenantId, id);
  }

  @Patch(":id/assign-driver")
  @ApiOperation({ summary: "Assign/unassign a driver to this fleet vehicle" })
  async assignDriver(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: AssignFleetVehicleDriverDto,
  ) {
    return this.fleetVehiclesService.assignDriver(req.tenant.tenantId, id, dto);
  }
}

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
import { VehiclesService } from "./vehicles.service";
import { CreateVehicleDto } from "./dto/create-vehicle.dto";
import { UpdateVehicleDto } from "./dto/update-vehicle.dto";
import { ListVehiclesQueryDto } from "./dto/list-vehicles.query.dto";
import { AssignVehicleDriverDto } from "./dto/assign-vehicle-driver.dto";

@ApiTags("vehicles")
@Controller("vehicles")
@UseGuards(AuthGuard, TenantGuard)
@ApiBearerAuth("JWT-auth")
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Post()
  @ApiOperation({ summary: "Create a vehicle (tenant-scoped)" })
  async create(@Req() req: any, @Body() dto: CreateVehicleDto) {
    const tenantId = req.tenant.tenantId;
    return this.vehiclesService.create(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: "List vehicles with filters and pagination" })
  async list(@Req() req: any, @Query() query: ListVehiclesQueryDto) {
    const tenantId = req.tenant.tenantId;
    return this.vehiclesService.list(tenantId, query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get vehicle by id" })
  async getById(@Req() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    return this.vehiclesService.getById(tenantId, id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update vehicle" })
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    const tenantId = req.tenant.tenantId;
    return this.vehiclesService.update(tenantId, id, dto);
  }

  @Post(":id/suspend")
  @ApiOperation({ summary: "Set vehicle status to INACTIVE" })
  async suspend(@Req() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    return this.vehiclesService.suspend(tenantId, id);
  }

  @Post(":id/unsuspend")
  @ApiOperation({ summary: "Set vehicle status to ACTIVE" })
  async unsuspend(@Req() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    return this.vehiclesService.unsuspend(tenantId, id);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete vehicle (hard delete)" })
  async delete(@Req() req: any, @Param("id") id: string) {
    const tenantId = req.tenant.tenantId;
    return this.vehiclesService.delete(tenantId, id);
  }

  @Patch(":id/assign-driver")
  @ApiOperation({ summary: "Assign/unassign a driver to this vehicle" })
  async assignDriver(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: AssignVehicleDriverDto,
  ) {
    const tenantId = req.tenant.tenantId;
    return this.vehiclesService.assignDriver(
      tenantId,
      id,
      dto.driverId ?? null,
    );
  }
}

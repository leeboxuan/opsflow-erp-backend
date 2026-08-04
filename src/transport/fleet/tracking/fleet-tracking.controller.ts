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
import { AuthGuard } from "../../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../../shared/auth/guards/tenant.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../../shared/auth/guards/module-entitlement.guard";
import { TenantModule } from "@prisma/client";
import { AssignGpsDeviceChassisDto } from "./dto/assign-gps-device-chassis.dto";
import { ChassisHistoryQueryDto } from "./dto/chassis-history-query.dto";
import { CreateChassisDto } from "./dto/create-chassis.dto";
import { CreateGpsDeviceDto } from "./dto/create-gps-device.dto";
import { ListChassisQueryDto } from "./dto/list-chassis-query.dto";
import { ListGpsDevicesQueryDto } from "./dto/list-gps-devices-query.dto";
import { UpdateChassisDto } from "./dto/update-chassis.dto";
import { UpdateGpsDeviceDto } from "./dto/update-gps-device.dto";
import { FleetTrackingService } from "./fleet-tracking.service";

@ApiTags("fleet-tracking")
@Controller("fleet-tracking")
@UseGuards(AuthGuard, TenantGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.TRANSPORT)
@ApiBearerAuth("JWT-auth")
export class FleetTrackingController {
  constructor(private readonly fleetTracking: FleetTrackingService) {}

  @Get("chassis")
  @ApiOperation({ summary: "List chassis with live tracking status" })
  listChassis(@Req() req: any, @Query() query: ListChassisQueryDto) {
    return this.fleetTracking.listChassis(req.tenant.tenantId, query);
  }

  @Post("chassis")
  @ApiOperation({ summary: "Create chassis" })
  createChassis(@Req() req: any, @Body() dto: CreateChassisDto) {
    return this.fleetTracking.createChassis(req.tenant.tenantId, dto);
  }

  @Get("chassis/:chassisId/history")
  @ApiOperation({ summary: "Get chassis GPS route history for a day" })
  getChassisHistory(
    @Req() req: any,
    @Param("chassisId") chassisId: string,
    @Query() query: ChassisHistoryQueryDto,
  ) {
    return this.fleetTracking.getChassisHistory(req.tenant.tenantId, chassisId, query);
  }

  @Get("chassis/:id")
  @ApiOperation({ summary: "Get chassis by id" })
  getChassis(@Req() req: any, @Param("id") id: string) {
    return this.fleetTracking.getChassisById(req.tenant.tenantId, id);
  }

  @Patch("chassis/:id")
  @ApiOperation({ summary: "Update chassis" })
  patchChassis(@Req() req: any, @Param("id") id: string, @Body() dto: UpdateChassisDto) {
    return this.fleetTracking.updateChassis(req.tenant.tenantId, id, dto);
  }

  @Delete("chassis/:id")
  @ApiOperation({ summary: "Delete/deactivate chassis" })
  deleteChassis(@Req() req: any, @Param("id") id: string) {
    return this.fleetTracking.deleteChassis(req.tenant.tenantId, id);
  }

  @Get("gps-devices")
  @ApiOperation({ summary: "List GPS devices" })
  listGpsDevices(@Req() req: any, @Query() query: ListGpsDevicesQueryDto) {
    return this.fleetTracking.listGpsDevices(req.tenant.tenantId, query);
  }

  @Post("gps-devices")
  @ApiOperation({ summary: "Create GPS device" })
  createGpsDevice(@Req() req: any, @Body() dto: CreateGpsDeviceDto) {
    return this.fleetTracking.createGpsDevice(req.tenant.tenantId, dto);
  }

  @Get("gps-devices/:id")
  @ApiOperation({ summary: "Get GPS device by id" })
  getGpsDevice(@Req() req: any, @Param("id") id: string) {
    return this.fleetTracking.getGpsDeviceById(req.tenant.tenantId, id);
  }

  @Patch("gps-devices/:id")
  @ApiOperation({ summary: "Update GPS device" })
  patchGpsDevice(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: UpdateGpsDeviceDto,
  ) {
    return this.fleetTracking.updateGpsDevice(req.tenant.tenantId, id, dto);
  }

  @Patch("gps-devices/:id/assign-chassis")
  @ApiOperation({ summary: "Assign or unassign GPS device chassis" })
  assignGpsDeviceChassis(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: AssignGpsDeviceChassisDto,
  ) {
    return this.fleetTracking.assignGpsDeviceChassis(req.tenant.tenantId, id, dto);
  }

  @Get("live/chassis-locations")
  @ApiOperation({ summary: "Get live non-inactive chassis locations" })
  liveChassisLocations(@Req() req: any) {
    return this.fleetTracking.liveChassisLocations(req.tenant.tenantId);
  }
}

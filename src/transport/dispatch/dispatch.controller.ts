import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Role, TenantModule } from "@prisma/client";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { RoleGuard, Roles } from "../../shared/auth/guards/role.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../shared/auth/guards/module-entitlement.guard";
import { DispatchService } from "./dispatch.service";
import {
  DispatchBoardResponseDto,
  DispatchRouteQueryDto,
  DispatchRouteResponseDto,
  DispatchOptimiseRouteDto,
  DispatchReorderTripsDto,
} from "./dto/dispatch.dto";
import { DispatchRoutePlanningService } from "./dispatch-route-planning.service";
import {
  DispatchPlanPublishDto,
  DispatchPlanSaveDto,
  DispatchPlanSuggestDto,
} from "./dto/dispatch-route-planning.dto";

@ApiTags("dispatch")
@Controller("dispatch")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.TRANSPORT)
@Roles(Role.ADMIN, Role.TRANSPORT_STAFF)
@ApiBearerAuth("JWT-auth")
export class DispatchController {
  constructor(
    private readonly dispatchService: DispatchService,
    private readonly routePlanning: DispatchRoutePlanningService,
  ) {}

  @Get("board")
  @ApiOperation({ summary: "Get dispatch board data for tenant" })
  @ApiOkResponse({ type: DispatchBoardResponseDto })
  async board(@Req() req: any, @Query("date") date?: string) {
    const selectedDate = date?.trim();
    if (selectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      throw new BadRequestException("date must be YYYY-MM-DD");
    }
    return this.dispatchService.getBoard(req.tenant.tenantId, selectedDate);
  }

  @Get("route-planning")
  @ApiOperation({
    summary:
      "Phase 5: Get Dispatch route-planning board for an operating date (tenant timezone)",
  })
  async routePlanningBoard(@Req() req: any, @Query("date") date?: string) {
    const selectedDate = date?.trim();
    if (selectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      throw new BadRequestException("date must be YYYY-MM-DD");
    }
    return this.routePlanning.getBoard(req.tenant.tenantId, selectedDate);
  }

  @Post("route-planning/suggest")
  @ApiOperation({
    summary:
      "Phase 5: Suggest trip sequence for a driver lane (advisory; not persisted)",
  })
  async suggestRoutePlan(@Req() req: any, @Body() dto: DispatchPlanSuggestDto) {
    return this.routePlanning.suggestSequence(req.tenant.tenantId, dto);
  }

  @Patch("route-planning/save")
  @ApiOperation({
    summary:
      "Phase 5: Save driver-day trip sequence (and optional assignments) without publishing",
  })
  async saveRoutePlan(@Req() req: any, @Body() dto: DispatchPlanSaveDto) {
    return this.routePlanning.savePlan(req.tenant.tenantId, dto, req.user);
  }

  @Post("route-planning/publish")
  @ApiOperation({
    summary:
      "Phase 5: Publish DRAFT trips via existing trip publish lifecycle rules",
  })
  async publishRoutePlan(@Req() req: any, @Body() dto: DispatchPlanPublishDto) {
    return this.routePlanning.publishPlan(req.tenant.tenantId, dto, req.user);
  }

  @Get("routes")
  @ApiOperation({ summary: "Get road route polyline between two coordinates" })
  @ApiOkResponse({ type: DispatchRouteResponseDto })
  async getRoute(
    @Req() req: any,
    @Query() query: DispatchRouteQueryDto,
  ) {
    return this.dispatchService.getDispatchRoute(req.tenant.tenantId, query);
  }

  @Get("trips/:tripId/route")
  @ApiOperation({ summary: "Get road route polyline for a trip origin/destination" })
  @ApiOkResponse({ type: DispatchRouteResponseDto })
  async getTripRoute(
    @Req() req: any,
    @Param("tripId") tripId: string,
  ) {
    return this.dispatchService.getTripRoute(req.tenant.tenantId, tripId);
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

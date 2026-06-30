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
import { Role } from "@prisma/client";
import { AuthGuard } from "../../auth/guards/auth.guard";
import { RoleGuard, Roles } from "../../auth/guards/role.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { DispatchService } from "./dispatch.service";
import {
  DispatchBoardResponseDto,
  DispatchRouteQueryDto,
  DispatchRouteResponseDto,
  DispatchOptimiseRouteDto,
  DispatchReorderTripsDto,
} from "./dto/dispatch.dto";

@ApiTags("dispatch")
@Controller("dispatch")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.ADMIN, Role.OPS)
@ApiBearerAuth("JWT-auth")
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

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

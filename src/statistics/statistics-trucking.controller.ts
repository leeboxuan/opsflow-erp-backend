import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Role, TenantModule } from "@prisma/client";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../shared/auth/guards/module-entitlement.guard";
import { RoleGuard, Roles } from "../shared/auth/guards/role.guard";
import { TenantGuard } from "../shared/auth/guards/tenant.guard";
import {
  StatisticsContainerMovementsDto,
  StatisticsContainersDto,
  StatisticsCustomersDto,
  StatisticsCustomersQueryDto,
  StatisticsFleetDto,
  StatisticsLanesDto,
  StatisticsLookupsDto,
  StatisticsLookupsQueryDto,
  StatisticsLookupSelectedQueryDto,
  StatisticsTruckingContainersQueryDto,
  StatisticsTruckingFleetQueryDto,
  StatisticsTruckingLanesQueryDto,
  StatisticsTruckingMovementsQueryDto,
  StatisticsTruckingSummaryDto,
  StatisticsTruckingSummaryQueryDto,
} from "./dto";
import { StatisticsTenantRequest } from "./statistics.controller";
import { StatisticsCustomersService } from "./statistics-customers.service";
import { StatisticsLookupsService } from "./statistics-lookups.service";
import { StatisticsTruckingService } from "./statistics-trucking.service";

@ApiTags("Statistics")
@Controller("statistics")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.TRANSPORT)
@Roles(Role.ADMIN)
@ApiBearerAuth("JWT-auth")
export class StatisticsTruckingController {
  constructor(
    private readonly trucking: StatisticsTruckingService,
    private readonly customers: StatisticsCustomersService,
    private readonly lookups: StatisticsLookupsService,
  ) {}

  @Get("trucking/summary")
  @ApiOperation({ summary: "Trucking summary KPIs" })
  @ApiOkResponse({ type: StatisticsTruckingSummaryDto })
  getSummary(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsTruckingSummaryQueryDto,
  ): Promise<StatisticsTruckingSummaryDto> {
    return this.trucking.getSummary(req.tenant.tenantId, query);
  }

  @Get("trucking/movements")
  @ApiOperation({ summary: "Container movement ledger" })
  @ApiOkResponse({ type: StatisticsContainerMovementsDto })
  getMovements(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsTruckingMovementsQueryDto,
  ): Promise<StatisticsContainerMovementsDto> {
    return this.trucking.getMovements(req.tenant.tenantId, query);
  }

  @Get("trucking/containers")
  @ApiOperation({ summary: "Container aggregation including drivers touched" })
  @ApiOkResponse({ type: StatisticsContainersDto })
  getContainers(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsTruckingContainersQueryDto,
  ): Promise<StatisticsContainersDto> {
    return this.trucking.getContainers(req.tenant.tenantId, query);
  }

  @Get("trucking/lanes")
  @ApiOperation({ summary: "Lane/origin-destination aggregation" })
  @ApiOkResponse({ type: StatisticsLanesDto })
  getLanes(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsTruckingLanesQueryDto,
  ): Promise<StatisticsLanesDto> {
    return this.trucking.getLanes(req.tenant.tenantId, query);
  }

  @Get("trucking/fleet")
  @ApiOperation({ summary: "Fleet utilisation" })
  @ApiOkResponse({ type: StatisticsFleetDto })
  getFleet(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsTruckingFleetQueryDto,
  ): Promise<StatisticsFleetDto> {
    return this.trucking.getFleet(req.tenant.tenantId, query);
  }

  @Get("customers")
  @ApiOperation({ summary: "Customer workload and commercial contribution" })
  @ApiOkResponse({ type: StatisticsCustomersDto })
  getCustomers(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsCustomersQueryDto,
  ): Promise<StatisticsCustomersDto> {
    return this.customers.getCustomers(req.tenant.tenantId, query);
  }

  @Get("lookups")
  @ApiOperation({ summary: "Search human-readable Statistics filter options" })
  @ApiOkResponse({ type: StatisticsLookupsDto })
  searchLookups(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsLookupsQueryDto,
  ): Promise<StatisticsLookupsDto> {
    return this.lookups.search(req.tenant.tenantId, query);
  }

  @Get("lookups/selected")
  @ApiOperation({ summary: "Resolve selected Statistics filter labels" })
  @ApiOkResponse({ type: StatisticsLookupsDto })
  selectedLookups(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsLookupSelectedQueryDto,
  ): Promise<StatisticsLookupsDto> {
    return this.lookups.selected(req.tenant.tenantId, query);
  }
}

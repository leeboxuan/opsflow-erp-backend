import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../auth/guards/role.guard';
import { TripService } from './trip.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { TripDto } from './dto/trip.dto';
import { Role } from '@prisma/client';

@ApiTags('transport')
@Controller('transport/trips')
@UseGuards(AuthGuard, TenantGuard)
@ApiBearerAuth('JWT-auth')
export class TripController {
  constructor(private readonly tripService: TripService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new trip' })
  async createTrip(
    @Request() req: any,
    @Body() dto: CreateTripDto,
  ): Promise<TripDto> {
    const tenantId = req.tenant.tenantId;
    return this.tripService.createTrip(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List trips' })
  async listTrips(
    @Request() req: any,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<{ trips: TripDto[]; nextCursor?: string }> {
    const tenantId = req.tenant.tenantId;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.tripService.listTrips(tenantId, cursor, limitNum);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get trip by ID' })
  async getTrip(
    @Request() req: any,
    @Param('id') id: string,
  ): Promise<TripDto> {
    const tenantId = req.tenant.tenantId;
    const trip = await this.tripService.getTripById(tenantId, id);

    if (!trip) {
      throw new NotFoundException('Trip not found');
    }

    return trip;
  }

  @Post(':id/dispatch')
  @UseGuards(RoleGuard)
  @Roles(Role.Admin, Role.Ops)
  @ApiOperation({ summary: 'Dispatch a trip (Admin/Ops only)' })
  async dispatchTrip(
    @Request() req: any,
    @Param('id') id: string,
  ): Promise<TripDto> {
    const tenantId = req.tenant.tenantId;
    return this.tripService.transitionStatus(tenantId, id, 'Dispatched');
  }

  @Post(':id/start')
  @UseGuards(RoleGuard)
  @Roles(Role.Driver, Role.Ops, Role.Admin)
  @ApiOperation({ summary: 'Start a trip (Driver/Ops/Admin)' })
  async startTrip(
    @Request() req: any,
    @Param('id') id: string,
  ): Promise<TripDto> {
    const tenantId = req.tenant.tenantId;
    return this.tripService.transitionStatus(tenantId, id, 'InTransit');
  }

  @Post(':id/complete')
  @UseGuards(RoleGuard)
  @Roles(Role.Driver, Role.Ops, Role.Admin)
  @ApiOperation({ summary: 'Complete a trip (Driver/Ops/Admin)' })
  async completeTrip(
    @Request() req: any,
    @Param('id') id: string,
  ): Promise<TripDto> {
    const tenantId = req.tenant.tenantId;
    return this.tripService.transitionStatus(tenantId, id, 'Delivered');
  }

  @Get(':id/events')
  @UseGuards(RoleGuard)
  @Roles(Role.Driver, Role.Ops, Role.Admin)
  @ApiOperation({ summary: 'Get trip events (Driver/Ops/Admin)' })
  async getTripEvents(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    const tenantId = req.tenant.tenantId;
    return this.tripService.getTripEvents(tenantId, id);
  }
}

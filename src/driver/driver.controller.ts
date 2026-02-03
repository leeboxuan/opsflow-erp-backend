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
import { TripService } from '../transport/trip.service';
import { PrismaService } from '../prisma/prisma.service';
import { LocationService } from './location.service';
import { DriverMvpService } from './driver-mvp.service';
import { Role } from '@prisma/client';
import { AssignVehicleDto } from './dto/assign-vehicle.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationDto } from './dto/location.dto';
import { TripDto } from '../transport/dto/trip.dto';
import { DriverTripDto, DriverWalletDto } from './dto/driver-trip.dto';
import { AcceptTripDto } from './dto/accept-trip.dto';
import { CompleteStopDto } from './dto/complete-stop.dto';

@ApiTags('driver')
@Controller('driver')
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.Driver)
@ApiBearerAuth('JWT-auth')
export class DriverController {
  constructor(
    private readonly tripService: TripService,
    private readonly prisma: PrismaService,
    private readonly locationService: LocationService,
    private readonly driverMvpService: DriverMvpService,
  ) {}

  @Get('trips')
  @ApiOperation({ summary: 'Get trips for current driver by date (MVP: includes stops, delivery order summary, lock state)' })
  async getTripsByDate(
    @Request() req: any,
    @Query('date') date?: string,
  ): Promise<{ trips: DriverTripDto[] }> {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    const dateStr = date ?? new Date().toISOString().slice(0, 10);
    return this.driverMvpService.getTripsByDate(tenantId, userId, dateStr);
  }

  @Post('trips/:tripId/accept')
  @ApiOperation({ summary: 'Accept trip with vehicleNo, trailerNo' })
  async acceptTrip(
    @Request() req: any,
    @Param('tripId') tripId: string,
    @Body() dto: AcceptTripDto,
  ): Promise<DriverTripDto> {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverMvpService.acceptTrip(tenantId, userId, tripId, dto);
  }

  @Post('trips/:tripId/start')
  @ApiOperation({ summary: 'Start trip (all stops must be Pending)' })
  async startTrip(
    @Request() req: any,
    @Param('tripId') tripId: string,
  ): Promise<DriverTripDto> {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverMvpService.startTrip(tenantId, userId, tripId);
  }

  @Post('stops/:stopId/start')
  @ApiOperation({ summary: 'Start stop (previous stop must be completed)' })
  async startStop(
    @Request() req: any,
    @Param('stopId') stopId: string,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverMvpService.startStop(tenantId, userId, stopId);
  }

  @Post('stops/:stopId/complete')
  @ApiOperation({ summary: 'Complete stop with POD photo keys; updates order; closes trip and wallet on final stop' })
  async completeStop(
    @Request() req: any,
    @Param('stopId') stopId: string,
    @Body() dto: CompleteStopDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    return this.driverMvpService.completeStop(tenantId, userId, stopId, dto);
  }

  @Get('wallet')
  @ApiOperation({ summary: 'Get driver wallet transactions for month (YYYY-MM)' })
  async getWallet(
    @Request() req: any,
    @Query('month') month: string,
  ): Promise<DriverWalletDto> {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;
    const monthStr = month ?? new Date().toISOString().slice(0, 7);
    return this.driverMvpService.getWallet(tenantId, userId, monthStr);
  }

  @Post('trips/:tripId/select-vehicle')
  @ApiOperation({
    summary: 'Select vehicle for a trip (Driver only)',
  })
  async selectVehicle(
    @Request() req: any,
    @Param('tripId') tripId: string,
    @Body() dto: AssignVehicleDto,
  ): Promise<TripDto> {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;

    const trip = await this.prisma.trip.findFirst({
      where: {
        id: tripId,
        tenantId,
        assignedDriverId: userId,
      },
    });

    if (!trip) {
      throw new NotFoundException(
        'Trip not found or not assigned to you',
      );
    }

    return this.tripService.assignVehicle(tenantId, tripId, dto);
  }

  @Post('location')
  @ApiOperation({ summary: 'Update driver location' })
  async updateLocation(
    @Request() req: any,
    @Body() dto: UpdateLocationDto,
  ): Promise<LocationDto> {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;

    return this.locationService.upsertLocation(tenantId, userId, dto);
  }

  @Get('location/me')
  @ApiOperation({ summary: 'Get my latest location' })
  async getMyLocation(
    @Request() req: any,
  ): Promise<LocationDto | { message: string }> {
    const tenantId = req.tenant.tenantId;
    const userId = req.user.userId;

    const location = await this.locationService.getLatestLocation(
      tenantId,
      userId,
    );

    if (!location) {
      return { message: 'No location data available' };
    }

    return location;
  }
}

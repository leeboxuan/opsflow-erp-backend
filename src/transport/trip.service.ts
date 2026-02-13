import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TripStatus, StopType } from '@prisma/client';
import { CreateTripDto } from './dto/create-trip.dto';
import {
  TripDto,
  StopDto,
  PodDto,
  VehicleInfoDto,
  DriverInfoDto,
  DriverLocationDto
} from './dto/trip.dto';
import { EventLogService } from './event-log.service';
import { AssignVehicleDto } from '../driver/dto/assign-vehicle.dto';
import { Role, MembershipStatus } from '@prisma/client';

@Injectable()
export class TripService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogService: EventLogService,
  ) { }

  async createTrip(tenantId: string, dto: CreateTripDto): Promise<TripDto> {
    // Normalize and validate stop sequences
    const normalizedStops = dto.stops
      .map((stop, index) => ({
        ...stop,
        sequence: stop.sequence || index + 1,
      }))
      .sort((a, b) => a.sequence - b.sequence);

    // Validate sequences are unique and start from 1
    const sequences = normalizedStops.map((s) => s.sequence);
    if (sequences[0] !== 1) {
      throw new BadRequestException('Stop sequence must start from 1');
    }
    if (new Set(sequences).size !== sequences.length) {
      throw new BadRequestException('Stop sequences must be unique');
    }

    // Create trip and stops in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const trip = await tx.trip.create({
        data: {
          tenantId,
          status: TripStatus.Draft,
          plannedStartAt: dto.plannedStartAt
            ? new Date(dto.plannedStartAt)
            : null,
          plannedEndAt: dto.plannedEndAt ? new Date(dto.plannedEndAt) : null,
        },
      });

      const stops = await Promise.all(
        normalizedStops.map((stopDto) =>
          tx.stop.create({
            data: {
              tenantId,
              tripId: trip.id,
              sequence: stopDto.sequence,
              type: stopDto.type,
              addressLine1: stopDto.addressLine1,
              addressLine2: stopDto.addressLine2 || null,
              city: stopDto.city,
              postalCode: stopDto.postalCode,
              country: stopDto.country,
              plannedAt: stopDto.plannedAt ? new Date(stopDto.plannedAt) : null,
              transportOrderId: stopDto.transportOrderId || null,
            },
          }),
        ),
      );

      return { trip, stops };
    });

    // Log events after transaction commits
    await this.eventLogService.logEvent(
      tenantId,
      'Trip',
      result.trip.id,
      'TRIP_CREATED',
      {
        plannedStartAt: result.trip.plannedStartAt,
        plannedEndAt: result.trip.plannedEndAt,
      },
    );

    for (const stop of result.stops) {
      await this.eventLogService.logEvent(
        tenantId,
        'Stop',
        stop.id,
        'STOP_CREATED',
        {
          sequence: stop.sequence,
          type: stop.type,
          tripId: result.trip.id,
        },
      );
    }

    return this.toDto(
      result.trip,
      result.stops.map((stop: any) => ({
        ...stop,
        pod: stop.pods?.[0] || null,
      })),
    );
  }

  async listTrips(
    tenantId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{ trips: TripDto[]; nextCursor?: string }> {
    const take = Math.min(limit, 100);

    const where = {
      tenantId,
      ...(cursor && {
        id: {
          gt: cursor,
        },
      }),
    };

    const trips = await this.prisma.trip.findMany({
      where,
      take: take + 1,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        stops: {
          orderBy: {
            sequence: 'asc',
          },
          include: {
            pods: {
              take: 1,
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        },
        vehicles: true,
      },
    });

    const hasMore = trips.length > take;
    const result = hasMore ? trips.slice(0, take) : trips;
    const nextCursor = hasMore ? result[result.length - 1].id : undefined;

    const tripsWithDetails = await Promise.all(
      result.map((trip) =>
        this.toDto(
          trip,
          trip.stops.map((stop) => ({
            ...stop,
            pod: stop.pods[0] || null,
          })),
        ),
      ),
    );

    return {
      trips: tripsWithDetails,
      nextCursor,
    };
  }

  async getTripById(tenantId: string, id: string): Promise<TripDto | null> {
    const trip = await this.prisma.trip.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        stops: {
          orderBy: {
            sequence: 'asc',
          },
          include: {
            pods: {
              take: 1,
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        },
        vehicles: true,
      },
    });

    if (!trip) {
      return null;
    }

    return this.toDto(
      trip,
      trip.stops.map((stop) => ({
        ...stop,
        pod: stop.pods[0] || null,
      })),
    );
  }

  private async toDto(trip: any, stops: any[]): Promise<TripDto> {
    // Get driver info if assigned
    let assignedDriver: DriverInfoDto | null = null;
    if (trip.assignedDriverUserId) {
      const membership = await this.prisma.tenantMembership.findFirst({
        where: {
          tenantId: trip.tenantId,
          userId: trip.assignedDriverUserId,
          status: MembershipStatus.Active,
        },
        include: {
          user: true,
        },
      });
      if (membership) {
        const user = membership.user as { id: string; email: string; name: string | null; phone?: string | null };
        assignedDriver = {
          id: user.id,
          email: user.email,
          name: user.name ?? null,
          phone: user.phone ?? null,
        };
      }
    }

    // Get vehicle info if assigned
    let assignedVehicle: VehicleInfoDto | null = null;
    if (trip.vehicles) {
      assignedVehicle = {
        id: trip.vehicles.id,
        vehicleNumber: trip.vehicles.vehicleNumber,
        type: trip.vehicles.type ?? null,
      };
    }
    // Get driver's latest location if assigned
    let driverLocation: DriverLocationDto | null = null;
    if (trip.assignedDriverUserId) {
      const loc = await this.prisma.driverLocationLatest.findUnique({
        where: {
          tenantId_driverUserId: {
            tenantId: trip.tenantId,
            driverUserId: trip.assignedDriverUserId,
          },
        },
      });

      if (loc) {
        driverLocation = {
          lat: loc.lat,
          lng: loc.lng,
          accuracy: loc.accuracy,
          heading: loc.heading,
          speed: loc.speed,
          capturedAt: loc.capturedAt,
          updatedAt: loc.updatedAt,
        };
      }
    }

    return {
      id: trip.id,
      status: trip.status,
      plannedStartAt: trip.plannedStartAt,
      plannedEndAt: trip.plannedEndAt,
      assignedDriverId: trip.assignedDriverUserId,
      assignedVehicleId: trip.vehicleId,
      assignedDriver,
      assignedVehicle,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
      stops: stops.map((stop) => this.stopToDto(stop)),
      driverLocation,
    };
  }

  private stopToDto(stop: any): StopDto {
    return {
      id: stop.id,
      sequence: stop.sequence,
      type: stop.type,
      addressLine1: stop.addressLine1,
      addressLine2: stop.addressLine2,
      city: stop.city,
      postalCode: stop.postalCode,
      country: stop.country,
      plannedAt: stop.plannedAt,
      transportOrderId: stop.transportOrderId,
      createdAt: stop.createdAt,
      updatedAt: stop.updatedAt,
      pod: stop.pod ? this.podToDto(stop.pod) : null,
    };
  }

  private podToDto(pod: any): PodDto {
    return {
      id: pod.id,
      status: pod.status,
      signedBy: pod.signedBy,
      signedAt: pod.signedAt,
      photoUrl: pod.photoUrl,
      createdAt: pod.createdAt,
      updatedAt: pod.updatedAt,
    };
  }

  async transitionStatus(
    tenantId: string,
    tripId: string,
    newStatus: string,
  ): Promise<TripDto> {
    // Map string status to enum
    const statusMap: Record<string, TripStatus> = {
      Planned: TripStatus.Planned,
      Dispatched: TripStatus.Dispatched,
      InTransit: TripStatus.InTransit,
      Delivered: TripStatus.Delivered,
      Closed: TripStatus.Closed,
      Cancelled: TripStatus.Cancelled,
    };

    const targetStatus = statusMap[newStatus];
    if (!targetStatus) {
      throw new BadRequestException(`Invalid status transition: ${newStatus}`);
    }

    // Get current trip
    const trip = await this.prisma.trip.findFirst({
      where: {
        id: tripId,
        tenantId,
      },
      include: {
        stops: {
          orderBy: {
            sequence: 'asc',
          },
          include: {
            pods: {
              take: 1,
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        },
      },
    });

    if (!trip) {
      throw new NotFoundException('Trip not found');
    }

    // Validate status transition
    const validTransitions: Record<TripStatus, TripStatus[]> = {
      [TripStatus.Draft]: [TripStatus.Planned, TripStatus.Cancelled],
      [TripStatus.Planned]: [TripStatus.Dispatched, TripStatus.Cancelled],
      [TripStatus.Dispatched]: [TripStatus.InTransit, TripStatus.Cancelled],
      [TripStatus.InTransit]: [TripStatus.Delivered, TripStatus.Cancelled],
      [TripStatus.Delivered]: [TripStatus.Closed],
      [TripStatus.Closed]: [],
      [TripStatus.Cancelled]: [],
    };

    const allowedStatuses = validTransitions[trip.status];
    if (!allowedStatuses.includes(targetStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${trip.status} to ${targetStatus}`,
      );
    }

    // Update trip status
    const updatedTrip = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: targetStatus },
      include: {
        stops: {
          orderBy: {
            sequence: 'asc',
          },
          include: {
            pods: {
              take: 1,
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        },
      },
    });

    // Log event
    await this.eventLogService.logEvent(
      tenantId,
      'Trip',
      tripId,
      `TRIP_${newStatus.toUpperCase()}`,
      {
        previousStatus: trip.status,
        newStatus: targetStatus,
      },
    );

    return this.toDto(
      updatedTrip,
      updatedTrip.stops.map((stop) => ({
        ...stop,
        pod: stop.pods[0] || null,
      })),
    );
  }

  async getTripEvents(tenantId: string, tripId: string) {
    // Verify trip exists
    const trip = await this.prisma.trip.findFirst({
      where: {
        id: tripId,
        tenantId,
      },
    });

    if (!trip) {
      throw new NotFoundException('Trip not found');
    }

    // Get events for this trip
    const events = await this.prisma.eventLog.findMany({
      where: {
        tenantId,
        entityType: 'Trip',
        entityId: tripId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      tripId,
      events: events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        payload: event.payload,
        createdAt: event.createdAt,
      })),
    };
  }

  async listTripsForDriver(
    tenantId: string,
    driverUserId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{ trips: TripDto[]; nextCursor?: string }> {
    const take = Math.min(limit, 100);

    const where = {
      tenantId,
      assignedDriverUserId: driverUserId,
      ...(cursor && {
        id: {
          gt: cursor,
        },
      }),
    };

    const trips = await this.prisma.trip.findMany({
      where,
      take: take + 1,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        stops: {
          orderBy: {
            sequence: 'asc',
          },
          include: {
            pods: {
              take: 1,
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        },
        vehicles: true,
      },
    });

    const hasMore = trips.length > take;
    const result = hasMore ? trips.slice(0, take) : trips;
    const nextCursor = hasMore ? result[result.length - 1].id : undefined;

    const tripsWithDetails = await Promise.all(
      result.map((trip) =>
        this.toDto(
          trip,
          trip.stops.map((stop) => ({
            ...stop,
            pod: stop.pods[0] || null,
          })),
        ),
      ),
    );

    return {
      trips: tripsWithDetails,
      nextCursor,
    };
  }

  async assignDriver(
    tenantId: string,
    tripId: string,
    driverUserId: string,
  ): Promise<TripDto> {
    // Verify trip exists and belongs to tenant
    const trip = await this.prisma.trip.findFirst({
      where: {
        id: tripId,
        tenantId,
      },
    });

    if (!trip) {
      throw new NotFoundException('Trip not found');
    }

    // Verify driver belongs to same tenant
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        tenantId,
        userId: driverUserId,
        role: Role.Driver,
        status: MembershipStatus.Active,
      },
    });

    if (!membership) {
      throw new NotFoundException(
        'Driver not found or not active in this tenant',
      );
    }

    // Update trip with assigned driver
    const updatedTrip = await this.prisma.trip.update({
      where: { id: tripId },
      data: { assignedDriverUserId: driverUserId },
      include: {
        stops: {
          orderBy: {
            sequence: 'asc',
          },
          include: {
            pods: {
              take: 1,
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        },
        vehicles: true,
      },
    });

    // Log event
    await this.eventLogService.logEvent(tenantId, 'Trip', tripId, 'DRIVER_ASSIGNED', {
      driverUserId,
    });

    return this.toDto(
      updatedTrip,
      updatedTrip.stops.map((stop) => ({
        ...stop,
        pod: stop.pods[0] || null,
      })),
    );
  }

  async assignVehicle(
    tenantId: string,
    tripId: string,
    dto: AssignVehicleDto,
  ): Promise<TripDto> {
    // Verify trip exists and belongs to tenant
    const trip = await this.prisma.trip.findFirst({
      where: {
        id: tripId,
        tenantId,
      },
    });

    if (!trip) {
      throw new NotFoundException('Trip not found');
    }

    // Find vehicle by ID or vehicleNumber
    let vehicle;
    if (dto.vehicleId) {
      vehicle = await this.prisma.vehicle.findFirst({
        where: {
          id: dto.vehicleId,
          tenantId,
        },
      });
    } else if (dto.vehicleNumber) {
      vehicle = await this.prisma.vehicle.findUnique({
        where: {
          tenantId_vehicleNumber: {
            tenantId,
            vehicleNumber: dto.vehicleNumber,
          },
        },
      });
    }

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found in this tenant');
    }

    // Update trip with assigned vehicle
    const updatedTrip = await this.prisma.trip.update({
      where: { id: tripId },
      data: { vehicleId: vehicle.id },
      include: {
        stops: {
          orderBy: {
            sequence: 'asc',
          },
          include: {
            pods: {
              take: 1,
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        },
        vehicles: true,
      },
    });

    // Log event
    await this.eventLogService.logEvent(tenantId, 'Trip', tripId, 'VEHICLE_ASSIGNED', {
      vehicleId: vehicle.id,
      vehicleNumber: vehicle.vehicleNumber,
    });

    return this.toDto(
      updatedTrip,
      updatedTrip.stops.map((stop) => ({
        ...stop,
        pod: stop.pods[0] || null,
      })),
    );
  }
}

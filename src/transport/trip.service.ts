import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TripStatus, StopType } from '@prisma/client';
import { CreateTripDto } from './dto/create-trip.dto';
import { TripDto, StopDto, PodDto } from './dto/trip.dto';
import { EventLogService } from './event-log.service';

@Injectable()
export class TripService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogService: EventLogService,
  ) {}

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

    return this.toDto(result.trip, result.stops);
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
      },
    });

    const hasMore = trips.length > take;
    const result = hasMore ? trips.slice(0, take) : trips;
    const nextCursor = hasMore ? result[result.length - 1].id : undefined;

    return {
      trips: result.map((trip) =>
        this.toDto(
          trip,
          trip.stops.map((stop) => ({
            ...stop,
            pod: stop.pods[0] || null,
          })),
        ),
      ),
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

  private toDto(trip: any, stops: any[]): TripDto {
    return {
      id: trip.id,
      status: trip.status,
      plannedStartAt: trip.plannedStartAt,
      plannedEndAt: trip.plannedEndAt,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
      stops: stops.map((stop) => this.stopToDto(stop)),
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
}

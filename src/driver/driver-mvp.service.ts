import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventLogService } from '../transport/event-log.service';
import {
  TripStatus,
  StopStatus,
  OrderStatus,
  InventoryUnitStatus,
  StopType,
} from '@prisma/client';
import {
  DriverTripDto,
  DriverStopDto,
  DeliveryOrderSummaryDto,
  TripLockStateDto,
  DriverWalletDto,
  DriverWalletTransactionDto,
} from './dto/driver-trip.dto';
import { AcceptTripDto } from './dto/accept-trip.dto';
import { CompleteStopDto } from './dto/complete-stop.dto';

@Injectable()
export class DriverMvpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogService: EventLogService,
  ) {}

  /**
   * GET /driver/trips?date=YYYY-MM-DD
   * Returns trips for the driver on the given date, with ordered stops, delivery order summary, and lock state.
   */
  async getTripsByDate(
    tenantId: string,
    driverUserId: string,
    date: string,
  ): Promise<{ trips: DriverTripDto[] }> {
    const dayStart = new Date(date);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        assignedDriverUserId: driverUserId,
        plannedStartAt: {
          gte: dayStart,
          lt: dayEnd,
        },
      },
      orderBy: { plannedStartAt: 'asc' },
      include: {
        stops: {
          orderBy: { sequence: 'asc' },
          include: {
            transportOrder: true,
            podPhotoDocuments: true,
            pods: { take: 1, orderBy: { createdAt: 'desc' } },
          },
        },
        vehicles: true,
      },
    });

    const result: DriverTripDto[] = [];
    for (const trip of trips) {
      const lockState = this.computeLockState(trip.stops, trip.status);
      result.push({
        id: trip.id,
        status: trip.status,
        plannedStartAt: trip.plannedStartAt,
        plannedEndAt: trip.plannedEndAt,
        assignedDriverId: trip.assignedDriverUserId,
        assignedVehicleId: trip.vehicleId,
        trailerNo: trip.acceptedTrailerNo ?? trip.acceptedVehicleNo ?? null,
        startedAt: trip.startedAt,
        closedAt: trip.closedAt,
        stops: trip.stops.map((s) => this.toDriverStopDto(s)),
        lockState,
        createdAt: trip.createdAt,
        updatedAt: trip.updatedAt,
      });
    }
    return { trips: result };
  }

  private computeLockState(
    stops: { id: string; sequence: number; status: StopStatus }[],
    tripStatus: TripStatus,
  ): TripLockStateDto {
    const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
    const completedCount = sorted.filter((s) => s.status === StopStatus.Completed).length;
    const allStopsCompleted = sorted.length > 0 && completedCount === sorted.length;
    const nextStop = sorted.find((s) => s.status !== StopStatus.Completed);
    const canStartStopId = nextStop?.status === StopStatus.Pending ? nextStop.id : null;
    const canStartTrip =
      tripStatus === TripStatus.Dispatched &&
      sorted.length > 0 &&
      sorted.every((s) => s.status === StopStatus.Pending);
    return {
      canStartTrip,
      canStartStopId,
      nextStopSequence: nextStop?.sequence ?? 0,
      allStopsCompleted,
    };
  }

  private toDriverStopDto(stop: {
    id: string;
    sequence: number;
    type: any;
    status: StopStatus;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    postalCode: string;
    country: string;
    plannedAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    transportOrderId: string | null;
    transportOrder?: { id: string; customerRef: string; status: OrderStatus } | null;
    podPhotoDocuments: { photoKey: string }[];
    createdAt: Date;
    updatedAt: Date;
  }): DriverStopDto {
    let deliveryOrder: DeliveryOrderSummaryDto | null = null;
    if (stop.transportOrder) {
      deliveryOrder = {
        id: stop.transportOrder.id,
        customerRef: stop.transportOrder.customerRef,
        status: stop.transportOrder.status,
      };
    }
    return {
      id: stop.id,
      sequence: stop.sequence,
      type: stop.type,
      status: stop.status,
      addressLine1: stop.addressLine1,
      addressLine2: stop.addressLine2,
      city: stop.city,
      postalCode: stop.postalCode,
      country: stop.country,
      plannedAt: stop.plannedAt,
      startedAt: stop.startedAt,
      completedAt: stop.completedAt,
      transportOrderId: stop.transportOrderId,
      deliveryOrder,
      podPhotoKeys: stop.podPhotoDocuments?.map((p) => p.photoKey) ?? [],
      createdAt: stop.createdAt,
      updatedAt: stop.updatedAt,
    };
  }

  /**
   * POST /trips/:tripId/accept — driver accepts trip with vehicleNo, trailerNo
   */
  async acceptTrip(
    tenantId: string,
    driverUserId: string,
    tripId: string,
    dto: AcceptTripDto,
  ): Promise<DriverTripDto> {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, assignedDriverUserId: driverUserId },
      include: {
        stops: {
          orderBy: { sequence: 'asc' },
          include: {
            transportOrder: true,
            podPhotoDocuments: true,
          },
        },
      },
    });
    if (!trip) {
      throw new NotFoundException('Trip not found or not assigned to you');
    }
    if (trip.status !== TripStatus.Dispatched && trip.status !== TripStatus.Planned) {
      throw new BadRequestException(
        `Trip cannot be accepted in status ${trip.status}`,
      );
    }

    let vehicleId = trip.vehicleId;
    if (dto.vehicleNo) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: {
          tenantId,
          vehicleNumber: dto.vehicleNo,
        },
      });
      if (!vehicle) {
        throw new NotFoundException('Vehicle not found');
      }
      vehicleId = vehicle.id;
    }

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        status: TripStatus.Dispatched,
        vehicleId: vehicleId ?? undefined,
        acceptedVehicleNo: dto.vehicleNo ?? trip.acceptedVehicleNo ?? undefined,
        acceptedTrailerNo: dto.trailerNo ?? trip.acceptedTrailerNo ?? undefined,
      },
      include: {
        stops: {
          orderBy: { sequence: 'asc' },
          include: {
            transportOrder: true,
            podPhotoDocuments: true,
          },
        },
      },
    });

    await this.eventLogService.logEvent(tenantId, 'Trip', tripId, 'TRIP_ACCEPTED', {
      vehicleNo: dto.vehicleNo,
      trailerNo: dto.trailerNo,
      vehicleId: updated.vehicleId,
    });

    const lockState = this.computeLockState(updated.stops, updated.status);
    return {
      id: updated.id,
      status: updated.status,
      plannedStartAt: updated.plannedStartAt,
      plannedEndAt: updated.plannedEndAt,
      assignedDriverId: updated.assignedDriverUserId,
      assignedVehicleId: updated.vehicleId,
      trailerNo: updated.acceptedTrailerNo ?? updated.acceptedVehicleNo ?? null,
      startedAt: updated.startedAt,
      closedAt: updated.closedAt,
      stops: updated.stops.map((s) => this.toDriverStopDto(s)),
      lockState,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * POST /trips/:tripId/start — start trip (transition to InTransit)
   */
  async startTrip(
    tenantId: string,
    driverUserId: string,
    tripId: string,
  ): Promise<DriverTripDto> {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, assignedDriverUserId: driverUserId },
      include: {
        stops: { orderBy: { sequence: 'asc' }, include: { transportOrder: true, podPhotoDocuments: true } },
      },
    });
    if (!trip) {
      throw new NotFoundException('Trip not found or not assigned to you');
    }
    if (trip.status !== TripStatus.Dispatched) {
      throw new BadRequestException(
        `Trip can only be started when status is Dispatched (current: ${trip.status})`,
      );
    }
    const allPending = trip.stops.every((s) => s.status === StopStatus.Pending);
    if (!allPending) {
      throw new BadRequestException('All stops must be Pending to start trip');
    }

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.InTransit, startedAt: new Date() },
      include: {
        stops: {
          orderBy: { sequence: 'asc' },
          include: { transportOrder: true, podPhotoDocuments: true },
        },
      },
    });

    await this.eventLogService.logEvent(tenantId, 'Trip', tripId, 'TRIP_STARTED', {});

    const lockState = this.computeLockState(updated.stops, updated.status);
    return {
      id: updated.id,
      status: updated.status,
      plannedStartAt: updated.plannedStartAt,
      plannedEndAt: updated.plannedEndAt,
      assignedDriverId: updated.assignedDriverUserId,
      assignedVehicleId: updated.vehicleId,
      trailerNo: updated.acceptedTrailerNo ?? updated.acceptedVehicleNo ?? null,
      startedAt: updated.startedAt,
      closedAt: updated.closedAt,
      stops: updated.stops.map((s) => this.toDriverStopDto(s)),
      lockState,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * POST /stops/:stopId/start — start stop N (only if stop N-1 is completed)
   */
  async startStop(
    tenantId: string,
    driverUserId: string,
    stopId: string,
  ): Promise<DriverStopDto> {
    const stop = await this.prisma.stop.findFirst({
      where: { id: stopId, tenantId },
      include: {
        trip: true,
        transportOrder: true,
        podPhotoDocuments: true,
      },
    });
    if (!stop) {
      throw new NotFoundException('Stop not found');
    }
    if (stop.trip.assignedDriverUserId !== driverUserId) {
      throw new ForbiddenException('Stop is not on a trip assigned to you');
    }
    if (stop.status !== StopStatus.Pending) {
      throw new BadRequestException(`Stop is not Pending (current: ${stop.status})`);
    }

    const prevStops = await this.prisma.stop.findMany({
      where: { tripId: stop.tripId!, tenantId, sequence: { lt: stop.sequence! } },
      orderBy: { sequence: 'desc' },
      take: 1,
    });
    if (prevStops.length > 0 && prevStops[0].status !== StopStatus.Completed) {
      throw new BadRequestException(
        `Cannot start stop ${stop.sequence} until stop ${prevStops[0].sequence} is completed`,
      );
    }

    const updated = await this.prisma.stop.update({
      where: { id: stopId },
      data: { status: StopStatus.InProgress, startedAt: new Date() },
      include: { transportOrder: true, podPhotoDocuments: true },
    });

    await this.eventLogService.logEvent(tenantId, 'Stop', stopId, 'STOP_STARTED', {});

    return this.toDriverStopDto(updated);
  }

  /**
   * POST /stops/:stopId/complete — complete stop with at least 1 POD photo key.
   * Updates delivery order status; if final stop, closes trip and writes wallet transaction(s).
   */
  async completeStop(
    tenantId: string,
    driverUserId: string,
    stopId: string,
    dto: CompleteStopDto,
  ): Promise<DriverStopDto> {
    if (!dto.podPhotoKeys?.length) {
      throw new BadRequestException('At least one POD photo key is required');
    }

    const stop = await this.prisma.stop.findFirst({
      where: { id: stopId, tenantId },
      include: {
        trip: true,
        transportOrder: true,
        podPhotoDocuments: true,
      },
    });
    if (!stop) {
      throw new NotFoundException('Stop not found');
    }
    if (stop.trip.assignedDriverUserId !== driverUserId) {
      throw new ForbiddenException('Stop is not on a trip assigned to you');
    }
    if (stop.status === StopStatus.Completed) {
      throw new BadRequestException('Stop is already completed');
    }

    const maxSequence = await this.prisma.stop.aggregate({
      where: { tripId: stop.tripId! },
      _max: { sequence: true },
    });
    const isFinalStop = maxSequence._max.sequence === stop.sequence;

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedStop = await tx.stop.update({
        where: { id: stopId },
        data: {
          status: StopStatus.Completed,
          completedAt: new Date(),
        },
        include: { transportOrder: true },
      });

      await tx.podPhotoDocument.deleteMany({ where: { stopId } });
      await tx.podPhotoDocument.createMany({
        data: dto.podPhotoKeys.map((photoKey) => ({
          tenantId,
          stopId,
          photoKey,
        })),
      });

      if (updatedStop.transportOrderId) {
        await tx.transportOrder.update({
          where: { id: updatedStop.transportOrderId },
          data: { status: OrderStatus.Delivered },
        });
        if (updatedStop.type === StopType.DELIVERY) {
          await tx.inventory_units.updateMany({
            where: {
              tenantId,
              transportOrderId: updatedStop.transportOrderId,
              status: { in: [InventoryUnitStatus.InTransit, InventoryUnitStatus.Reserved] },
            },
            data: { status: InventoryUnitStatus.Delivered },
          });
        }
      }

      if (isFinalStop) {
        await tx.trip.update({
          where: { id: stop.tripId! },
          data: {
            status: TripStatus.Delivered,
            closedAt: new Date(),
          },
        });
        const driver = await tx.drivers.findFirst({
          where: { tenantId, userId: driverUserId },
        });
        if (driver) {
          await tx.driverWalletTransaction.create({
            data: {
              tenantId,
              driverId: driver.id,
              tripId: stop.tripId!,
              amountCents: 0,
              currency: 'SGD',
              type: 'TripCompleted',
              description: `Trip ${stop.tripId} completed`,
            },
          });
        }
      }

      return tx.stop.findUnique({
        where: { id: stopId },
        include: { transportOrder: true, podPhotoDocuments: true },
      });
    });

    await this.eventLogService.logEvent(tenantId, 'Stop', stopId, 'STOP_COMPLETED', {
      podPhotoKeys: dto.podPhotoKeys,
      isFinalStop,
    });

    if (isFinalStop) {
      await this.eventLogService.logEvent(tenantId, 'Trip', stop.tripId, 'TRIP_DELIVERED', {});
    }

    return this.toDriverStopDto(updated!);
  }

  /**
   * GET /driver/wallet?month=YYYY-MM
   */
  async getWallet(
    tenantId: string,
    driverUserId: string,
    month: string,
  ): Promise<DriverWalletDto> {
    const [y, m] = month.split('-').map(Number);
    if (!y || !m || m < 1 || m > 12) {
      throw new BadRequestException('Invalid month format; use YYYY-MM');
    }
    const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));

    const driver = await this.prisma.drivers.findFirst({
      where: { tenantId, userId: driverUserId },
    });
    if (!driver) {
      return {
        month,
        transactions: [],
        totalCents: 0,
      };
    }

    const transactions = await this.prisma.driverWalletTransaction.findMany({
      where: {
        tenantId,
        driverId: driver.id,
        createdAt: { gte: start, lt: end },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalCents = transactions.reduce((sum, t) => sum + t.amountCents, 0);
    return {
      month,
      transactions: transactions.map(
        (t): DriverWalletTransactionDto => ({
          id: t.id,
          tripId: t.tripId,
          amountCents: t.amountCents,
          currency: t.currency,
          type: t.type,
          description: t.description,
          createdAt: t.createdAt,
        }),
      ),
      totalCents,
    };
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus, TransportOrder, TripStatus, StopType } from '@prisma/client';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderDto } from './dto/order.dto';
import { TripDto } from './dto/trip.dto';
import { EventLogService } from './event-log.service';

@Injectable()
export class TransportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogService: EventLogService,
  ) {}

  async createOrder(tenantId: string, dto: CreateOrderDto): Promise<OrderDto> {
    const order = await this.prisma.transportOrder.create({
      data: {
        tenantId,
        customerRef: dto.customerRef,
        status: OrderStatus.Draft,
        pickupWindowStart: dto.pickupWindowStart
          ? new Date(dto.pickupWindowStart)
          : null,
        pickupWindowEnd: dto.pickupWindowEnd
          ? new Date(dto.pickupWindowEnd)
          : null,
        deliveryWindowStart: dto.deliveryWindowStart
          ? new Date(dto.deliveryWindowStart)
          : null,
        deliveryWindowEnd: dto.deliveryWindowEnd
          ? new Date(dto.deliveryWindowEnd)
          : null,
        notes: dto.notes,
      },
    });

    return this.toDto(order);
  }

  async listOrders(
    tenantId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{ orders: OrderDto[]; nextCursor?: string }> {
    const take = Math.min(limit, 100); // Max 100 per page

    const where = {
      tenantId,
      ...(cursor && {
        id: {
          gt: cursor,
        },
      }),
    };

    const orders = await this.prisma.transportOrder.findMany({
      where,
      take: take + 1, // Fetch one extra to check if there's more
      orderBy: {
        createdAt: 'desc',
      },
    });

    const hasMore = orders.length > take;
    const result = hasMore ? orders.slice(0, take) : orders;
    const nextCursor = hasMore ? result[result.length - 1].id : undefined;

    return {
      orders: result.map((order) => this.toDto(order)),
      nextCursor,
    };
  }

  async getOrderById(tenantId: string, id: string): Promise<OrderDto | null> {
    const order = await this.prisma.transportOrder.findFirst({
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

    if (!order) {
      return null;
    }

    return this.toDtoWithStops(order);
  }

  async planTripFromOrder(
    tenantId: string,
    orderId: string,
  ): Promise<TripDto> {
    // Load order and create trip + stops + event logs in a single transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 1) Find TransportOrder by { id: orderId, tenantId } else 404
      const order = await tx.transportOrder.findFirst({
        where: {
          id: orderId,
          tenantId,
        },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      // 2) Create Trip
      const trip = await tx.trip.create({
        data: {
          tenantId,
          status: TripStatus.Draft,
          plannedStartAt: order.pickupWindowStart,
          plannedEndAt: order.deliveryWindowEnd,
        },
      });

      // 3) Create 2 Stops linked to the trip
      // a) Stop #1: sequence=1 type=PICKUP
      const pickupStop = await tx.stop.create({
        data: {
          tenantId,
          tripId: trip.id,
          sequence: 1,
          type: StopType.PICKUP,
          addressLine1: 'TBD',
          addressLine2: null,
          city: 'Singapore',
          postalCode: '000000',
          country: 'SG',
          plannedAt: order.pickupWindowStart,
          transportOrderId: order.id,
        },
      });

      // b) Stop #2: sequence=2 type=DELIVERY
      const deliveryStop = await tx.stop.create({
        data: {
          tenantId,
          tripId: trip.id,
          sequence: 2,
          type: StopType.DELIVERY,
          addressLine1: 'TBD',
          addressLine2: null,
          city: 'Singapore',
          postalCode: '000000',
          country: 'SG',
          plannedAt: order.deliveryWindowStart,
          transportOrderId: order.id,
        },
      });

      // 4) Create EventLog rows in transaction
      await tx.eventLog.create({
        data: {
          tenantId,
          entityType: 'Trip',
          entityId: trip.id,
          eventType: 'TRIP_CREATED',
          payload: {
            orderId: order.id,
            plannedStartAt: trip.plannedStartAt,
            plannedEndAt: trip.plannedEndAt,
          },
        },
      });

      await tx.eventLog.create({
        data: {
          tenantId,
          entityType: 'Stop',
          entityId: pickupStop.id,
          eventType: 'STOP_CREATED',
          payload: {
            orderId: order.id,
            tripId: trip.id,
            sequence: pickupStop.sequence,
            type: pickupStop.type,
          },
        },
      });

      await tx.eventLog.create({
        data: {
          tenantId,
          entityType: 'Stop',
          entityId: deliveryStop.id,
          eventType: 'STOP_CREATED',
          payload: {
            orderId: order.id,
            tripId: trip.id,
            sequence: deliveryStop.sequence,
            type: deliveryStop.type,
          },
        },
      });

      return { trip, stops: [pickupStop, deliveryStop] };
    });

    // Fetch trip with stops and pods for response
    const tripWithStops = await this.prisma.trip.findUnique({
      where: { id: result.trip.id },
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
        assignedVehicle: true,
      },
    });

    if (!tripWithStops) {
      throw new NotFoundException('Trip not found after creation');
    }

    return this.tripToDto(
      tripWithStops,
      tripWithStops.stops.map((stop) => ({
        ...stop,
        pod: stop.pods[0] || null,
      })),
    );
  }

  private toDto(order: TransportOrder): OrderDto {
    return {
      id: order.id,
      customerRef: order.customerRef,
      status: order.status,
      pickupWindowStart: order.pickupWindowStart,
      pickupWindowEnd: order.pickupWindowEnd,
      deliveryWindowStart: order.deliveryWindowStart,
      deliveryWindowEnd: order.deliveryWindowEnd,
      notes: order.notes,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private toDtoWithStops(order: any): OrderDto {
    return {
      id: order.id,
      customerRef: order.customerRef,
      status: order.status,
      pickupWindowStart: order.pickupWindowStart,
      pickupWindowEnd: order.pickupWindowEnd,
      deliveryWindowStart: order.deliveryWindowStart,
      deliveryWindowEnd: order.deliveryWindowEnd,
      notes: order.notes,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      stops: order.stops
        ? order.stops.map((stop: any) => ({
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
            pod: stop.pods && stop.pods[0]
              ? {
                  id: stop.pods[0].id,
                  status: stop.pods[0].status,
                  signedBy: stop.pods[0].signedBy,
                  signedAt: stop.pods[0].signedAt,
                  photoUrl: stop.pods[0].photoUrl,
                  createdAt: stop.pods[0].createdAt,
                  updatedAt: stop.pods[0].updatedAt,
                }
              : null,
          }))
        : undefined,
    };
  }

  private tripToDto(trip: any, stops: any[]): TripDto {
    return {
      id: trip.id,
      status: trip.status,
      plannedStartAt: trip.plannedStartAt,
      plannedEndAt: trip.plannedEndAt,
      assignedDriverId: trip.assignedDriverId || null,
      assignedVehicleId: trip.assignedVehicleId || null,
      assignedDriver: null, // TransportService doesn't load driver/vehicle details
      assignedVehicle: trip.assignedVehicle
        ? {
            id: trip.assignedVehicle.id,
            vehicleNumber: trip.assignedVehicle.vehicleNumber,
            type: trip.assignedVehicle.type,
          }
        : null,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
      stops: stops.map((stop) => ({
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
        pod: stop.pod
          ? {
              id: stop.pod.id,
              status: stop.pod.status,
              signedBy: stop.pod.signedBy,
              signedAt: stop.pod.signedAt,
              photoUrl: stop.pod.photoUrl,
              createdAt: stop.pod.createdAt,
              updatedAt: stop.pod.updatedAt,
            }
          : null,
      })),
    };
  }
}

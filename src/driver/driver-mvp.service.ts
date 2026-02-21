import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EventLogService } from "../transport/event-log.service";
import {
  TripStatus,
  StopStatus,
  OrderStatus,
  InventoryUnitStatus,
  StopType,
} from "@prisma/client";
import {
  DriverTripDto,
  DriverStopDto,
  DeliveryOrderSummaryDto,
  TripLockStateDto,
  DriverWalletDto,
  DriverWalletTransactionDto,
} from "./dto/driver-trip.dto";
import { AcceptTripDto } from "./dto/accept-trip.dto";
import { CompleteStopDto } from "./dto/complete-stop.dto";
import { GoogleMapsService } from "../common/google-maps.service";

@Injectable()
export class DriverMvpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogService: EventLogService,
    private readonly googleMaps: GoogleMapsService,

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
      orderBy: { plannedStartAt: "asc" },
      include: {
        stops: {
          orderBy: { sequence: "asc" },
          include: {
            transportOrder: true,
            podPhotoDocuments: true,
            pods: { take: 1, orderBy: { createdAt: "desc" } },
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
    const completedCount = sorted.filter(
      (s) => s.status === StopStatus.Completed,
    ).length;
    const allStopsCompleted =
      sorted.length > 0 && completedCount === sorted.length;
    const nextStop = sorted.find((s) => s.status !== StopStatus.Completed);
    const canStartStopId =
      nextStop?.status === StopStatus.Pending ? nextStop.id : null;
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
    transportOrder?: {
      id: string;
      customerRef: string;
      status: OrderStatus;
    } | null;
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
          orderBy: { sequence: "asc" },
          include: {
            transportOrder: true,
            podPhotoDocuments: true,
          },
        },
      },
    });
    if (!trip) {
      throw new NotFoundException("Trip not found or not assigned to you");
    }
    if (
      trip.status !== TripStatus.Dispatched &&
      trip.status !== TripStatus.Planned
    ) {
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
        throw new NotFoundException("Vehicle not found");
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
          orderBy: { sequence: "asc" },
          include: {
            transportOrder: true,
            podPhotoDocuments: true,
          },
        },
      },
    });

    await this.eventLogService.logEvent(
      tenantId,
      "Trip",
      tripId,
      "TRIP_ACCEPTED",
      {
        vehicleNo: dto.vehicleNo,
        trailerNo: dto.trailerNo,
        vehicleId: updated.vehicleId,
      },
    );

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
        stops: {
          orderBy: { sequence: "asc" },
          include: { transportOrder: true, podPhotoDocuments: true },
        },
      },
    });
    if (!trip) {
      throw new NotFoundException("Trip not found or not assigned to you");
    }
    if (trip.status !== TripStatus.Dispatched) {
      throw new BadRequestException(
        `Trip can only be started when status is Dispatched (current: ${trip.status})`,
      );
    }
    const allPending = trip.stops.every((s) => s.status === StopStatus.Pending);
    if (!allPending) {
      throw new BadRequestException("All stops must be Pending to start trip");
    }

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.InTransit, startedAt: new Date() },
      include: {
        stops: {
          orderBy: { sequence: "asc" },
          include: { transportOrder: true, podPhotoDocuments: true },
        },
      },
    });

    // flip inventory units: Dispatched -> InTransit when trip starts
    await (this.prisma as any).inventory_units.updateMany({
      where: {
        tenantId,
        tripId: trip.id,
        status: InventoryUnitStatus.Dispatched,
      },
      data: { status: InventoryUnitStatus.InTransit },
    });

    // flip order statuses too (optional but matches your mental model)
    await (this.prisma as any).transportOrder.updateMany({
      where: {
        tenantId,
        stops: { some: { tripId: trip.id } },
        status: InventoryUnitStatus.Dispatched,
      },
      data: { status: InventoryUnitStatus.InTransit },
    });
    await this.eventLogService.logEvent(
      tenantId,
      "Trip",
      tripId,
      "TRIP_STARTED",
      {},
    );

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
      throw new NotFoundException("Stop not found");
    }
    if (stop.trip.assignedDriverUserId !== driverUserId) {
      throw new ForbiddenException("Stop is not on a trip assigned to you");
    }
    if (stop.status !== StopStatus.Pending) {
      throw new BadRequestException(
        `Stop is not Pending (current: ${stop.status})`,
      );
    }

    const prevStops = await this.prisma.stop.findMany({
      where: {
        tripId: stop.tripId!,
        tenantId,
        sequence: { lt: stop.sequence! },
      },
      orderBy: { sequence: "desc" },
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

    await this.eventLogService.logEvent(
      tenantId,
      "Stop",
      stopId,
      "STOP_STARTED",
      {},
    );

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
      throw new BadRequestException("At least one POD photo key is required");
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
      throw new NotFoundException("Stop not found");
    }
    if (stop.trip.assignedDriverUserId !== driverUserId) {
      throw new ForbiddenException("Stop is not on a trip assigned to you");
    }
    if (stop.status === StopStatus.Completed) {
      throw new BadRequestException("Stop is already completed");
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
        const deliveredOrder = await tx.transportOrder.update({
          where: { id: updatedStop.transportOrderId },
          data: { status: OrderStatus.Delivered },
        });

        if (deliveredOrder.priceCents && deliveredOrder.priceCents > 0) {
          const driver = await tx.drivers.findFirst({
            where: { tenantId, userId: driverUserId },
          });

          if (driver) {
            // create once per (tripId, orderId) because schema has @@unique([tripId, transportOrderId])
            await tx.driverWalletTransaction
              .create({
                data: {
                  tenantId,
                  driverId: driver.id,
                  tripId: stop.tripId!,
                  transportOrderId: deliveredOrder.id,
                  amountCents: deliveredOrder.priceCents,
                  currency: deliveredOrder.currency ?? "SGD",
                  type: "OrderDelivered",
                  description: `Order ${deliveredOrder.internalRef ?? deliveredOrder.orderRef} delivered`,
                },
              })
              .catch(() => {
                // ignore duplicates if stop re-completed etc
              });
          }
        }

        if (updatedStop.type === StopType.DELIVERY) {
          await tx.inventory_units.updateMany({
            where: {
              tenantId,
              transportOrderId: updatedStop.transportOrderId,
              status: {
                in: [
                  InventoryUnitStatus.InTransit,
                  InventoryUnitStatus.Reserved,
                  InventoryUnitStatus.Dispatched,
                  
                ],
              },
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
              currency: "SGD",
              type: "TripCompleted",
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

    await this.eventLogService.logEvent(
      tenantId,
      "Stop",
      stopId,
      "STOP_COMPLETED",
      {
        podPhotoKeys: dto.podPhotoKeys,
        isFinalStop,
      },
    );

    if (isFinalStop) {
      await this.eventLogService.logEvent(
        tenantId,
        "Trip",
        stop.tripId,
        "TRIP_DELIVERED",
        {},
      );
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
    const [y, m] = month.split("-").map(Number);
    if (!y || !m || m < 1 || m > 12) {
      throw new BadRequestException("Invalid month format; use YYYY-MM");
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
      orderBy: { createdAt: "desc" },
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

  async listAvailableOrders(tenantId: string, driverUserId: string) {
    // “Available” = orders not yet assigned into any trip stop
    const orders = await (this.prisma as any).transportOrder.findMany({
      where: {
        tenantId,
        status: { in: ["Confirmed", "Planned"] },
        stops: { none: { tripId: { not: null } } },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        orderRef: true,
        internalRef: true,
        customerRef: true,
        customerName: true,
      },
    });
  
    return { count: orders.length, orders };
  }

  async createTripFromOrder(tenantId: string, driverUserId: string, orderId: string) {
    // basic guard: order must be “available”
    const order = await (this.prisma as any).transportOrder.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) throw new NotFoundException("Order not found");
  
    // Create trip + first delivery stop
    const trip = await (this.prisma as any).trip.create({
      data: {
        tenantId,
        status: "Draft",
        assignedDriverUserId: driverUserId,
        routeVersion: 1,
      },
    });
  
    await (this.prisma as any).stop.create({
      data: {
        tenantId,
        tripId: trip.id,
        type: StopType.DELIVERY,
        sequence: 1,
        addressLine1: "UNKNOWN", // ✅ replace with your order address fields if you have them
        city: "Singapore",
        postalCode: "000000",
        country: "SG",
        transportOrderId: order.id,
        status: StopStatus.Pending,
      },
    });
  
    // Optionally set order status -> Planned when accepted
    await (this.prisma as any).transportOrder.update({
      where: { id: order.id },
      data: { status: "Planned" },
    });
  
    return trip;
  }

  async addOrderToTrip(tenantId: string, driverUserId: string, tripId: string, orderId: string) {
    const trip = await (this.prisma as any).trip.findFirst({
      where: { id: tripId, tenantId, assignedDriverUserId: driverUserId },
      include: { stops: true },
    });
    if (!trip) throw new NotFoundException("Trip not found");
  
    if (!["Draft", "Planned"].includes(trip.status)) {
      throw new BadRequestException("Can only add orders to Draft/Planned trips");
    }
  
    const order = await (this.prisma as any).transportOrder.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) throw new NotFoundException("Order not found");
  
    const nextSeq =
      Math.max(0, ...(trip.stops.map((s: any) => s.sequence ?? 0))) + 1;
  
    await (this.prisma as any).stop.create({
      data: {
        tenantId,
        tripId: trip.id,
        type: StopType.DELIVERY,
        sequence: nextSeq,
        addressLine1: "UNKNOWN", // ✅ replace when your order has address fields
        city: "Singapore",
        postalCode: "000000",
        country: "SG",
        transportOrderId: order.id,
        status: StopStatus.Pending,
      },
    });

    await (this.prisma as any).transportOrder.update({
      where: { id: order.id },
      data: { status: "Planned" },
    });
  
    return { ok: true };
  }

  async dispatchTrip(tenantId: string, driverUserId: string, tripId: string, unitSkus: string[]) {
    const trip = await (this.prisma as any).trip.findFirst({
      where: { id: tripId, tenantId, assignedDriverUserId: driverUserId },
    });
    if (!trip) throw new NotFoundException("Trip not found");
  
    if (!["Draft", "Planned"].includes(trip.status)) {
      throw new BadRequestException("Trip must be Draft/Planned to dispatch");
    }
  
    // Update scanned units: Reserved -> Dispatched + attach tripId
    if (unitSkus.length > 0) {
      await (this.prisma as any).inventory_units.updateMany({
        where: {
          tenantId,
          unitSku: { in: unitSkus },
          status: InventoryUnitStatus.Reserved,
        },
        data: {
          status: InventoryUnitStatus.Dispatched,
          tripId: trip.id,
        },
      });
    }
  
    // Trip status -> Dispatched
    await (this.prisma as any).trip.update({
      where: { id: trip.id },
      data: { status: InventoryUnitStatus.Dispatched },
    });
  
    // Optional: order status -> Dispatched for all orders in trip
    await (this.prisma as any).transportOrder.updateMany({
      where: {
        tenantId,
        stops: { some: { tripId: trip.id } },
        status: { in: ["Planned", "Confirmed"] },
      },
      data: { status: InventoryUnitStatus.Dispatched },
    });
  
    return { ok: true };
  }

  async reorderStops(tenantId: string, driverUserId: string, tripId: string, stopIds: string[]) {
    const trip = await (this.prisma as any).trip.findFirst({
      where: { id: tripId, tenantId, assignedDriverUserId: driverUserId },
    });
    if (!trip) throw new NotFoundException("Trip not found");
  
    // Persist new sequences (1..n)
    await this.prisma.$transaction([
      ...stopIds.map((stopId, idx) =>
        (this.prisma as any).stop.update({
          where: { id: stopId },
          data: { sequence: idx + 1 },
        }),
      ),
      (this.prisma as any).trip.update({
        where: { id: trip.id },
        data: { routeVersion: (trip.routeVersion ?? 1) + 1 },
      }),
    ]);
  
    return { ok: true };
  }

  async getDoPayload(tenantId: string, driverUserId: string, orderId: string) {
    const stop = await this.prisma.stop.findFirst({
      where: {
        tenantId,
        transportOrderId: orderId,
        trip: { assignedDriverUserId: driverUserId },
      },
      include: {
        trip: true,
        transportOrder: true,
      },
    });
  
    if (!stop?.transportOrder) throw new NotFoundException("Order not found in your trips");
  
    const o: any = stop.transportOrder;
  
    // you can map these to your real fields later
    return {
      company: {
        name: "DB WISDOM SERVICES PTE LTD",
        addressLines: ["Office and Warehouse: 7 Gul Circle, Singapore 629563"],
        logoText: "DB",
      },
      order: {
        id: o.id,
        orderRef: o.internalRef ?? o.orderRef ?? o.customerRef ?? o.id,
        customerRef: o.customerRef ?? null,
        status: o.status,
      },
      recipient: {
        name: o.recipientName ?? o.customerName ?? "—",
        phone: o.recipientPhone ?? o.customerPhone ?? "—",
      },
      deliveryAddress: {
        line1: o.deliveryAddressLine1 ?? o.addressLine1 ?? stop.addressLine1 ?? "—",
        line2: o.deliveryAddressLine2 ?? o.addressLine2 ?? stop.addressLine2 ?? null,
        postalCode: o.deliveryPostalCode ?? o.postalCode ?? stop.postalCode ?? null,
        country: o.deliveryCountry ?? o.country ?? stop.country ?? "SG",
      },
      item: {
        itemCode: o.itemCode ?? o.skuCode ?? "—",
        qty: o.itemQty ?? 1,
        specialRequest: o.specialRequest ?? null,
      },
      meta: {
        stopId: stop.id,
        tripId: stop.tripId,
        generatedAtISO: new Date().toISOString(),
      },
      doState: {
        doStatus: o.doStatus ?? "DRAFT",
        doSignerName: o.doSignerName ?? null,
        doSignedAt: o.doSignedAt ?? null,
        doSignatureUrl: o.doSignatureUrl ?? null,
      },
    };
  }
  
  async signDeliveryOrder(
    tenantId: string,
    driverUserId: string,
    orderId: string,
    body: { signerName?: string; signaturePhotoKey: string },
  ) {
    const stop = await this.prisma.stop.findFirst({
      where: {
        tenantId,
        transportOrderId: orderId,
        trip: { assignedDriverUserId: driverUserId },
      },
      include: { transportOrder: true },
    });
    if (!stop?.transportOrder) throw new NotFoundException("Order not found in your trips");
  
    const updated = await this.prisma.transportOrder.update({
      where: { id: orderId },
      data: {
        doStatus: "SIGNED" as any,
        doSignerName: body.signerName ?? null,
        doSignedAt: new Date(),
        doSignatureUrl: body.signaturePhotoKey, // store key; resolve to signed url when needed
      } as any,
    });
  
    await this.eventLogService.logEvent(tenantId, "Order", orderId, "DO_SIGNED", {
      signerName: body.signerName ?? null,
      signaturePhotoKey: body.signaturePhotoKey,
    });
  
    return { ok: true, orderId: updated.id };
  }

  private stopAddressString(s: any) {
    return [s.addressLine1, s.addressLine2, s.postalCode, s.city, s.country].filter(Boolean).join(", ");
  }
  
  async geocodeTripStops(tenantId: string, driverUserId: string, tripId: string) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, assignedDriverUserId: driverUserId },
      include: { stops: true },
    });
    if (!trip) throw new NotFoundException("Trip not found");
  
    const updates: any[] = [];
  
    for (const s of trip.stops) {
      if (s.lat && s.lng && s.geocodedAt) continue;
  
      const addr = this.stopAddressString(s);
      if (!addr) continue;
  
      const geo = await this.googleMaps.geocodeAddress(addr);
  
      updates.push(
        this.prisma.stop.update({
          where: { id: s.id },
          data: {
            lat: geo.location.lat,
            lng: geo.location.lng,
            placeId: geo.placeId ?? null,
            geocodedAt: new Date(),
          },
        }),
      );
    }
  
    await this.prisma.$transaction(updates);
  
    return { ok: true, updatedCount: updates.length };
  }
  
  async optimizeTripRoute(tenantId: string, driverUserId: string, tripId: string) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, assignedDriverUserId: driverUserId },
      include: { stops: true },
    });
    if (!trip) throw new NotFoundException("Trip not found");
  
    const stops = [...trip.stops].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    if (stops.length < 3) return { ok: true, message: "Not enough stops to optimize" };
  
    // require lat/lng
    const missing = stops.filter((s) => !(s.lat && s.lng));
    if (missing.length > 0) {
      throw new BadRequestException("Some stops missing lat/lng. Call /route/geocode first.");
    }
  
    const origin = { lat: stops[0].lat!, lng: stops[0].lng! };
    const destination = { lat: stops[stops.length - 1].lat!, lng: stops[stops.length - 1].lng! };
    const waypoints = stops.slice(1, -1).map((s) => ({ lat: s.lat!, lng: s.lng! }));
  
    const { waypointOrder, polyline } = await this.googleMaps.optimizeRoute({
      origin,
      destination,
      waypoints,
    });
  
    // waypointOrder returns indices into waypoints array
    const optimized = [
      stops[0],
      ...waypointOrder.map((idx) => stops[idx + 1]),
      stops[stops.length - 1],
    ];
  
    await this.prisma.$transaction([
      ...optimized.map((s, idx) =>
        this.prisma.stop.update({
          where: { id: s.id },
          data: { sequence: idx + 1 },
        }),
      ),
      this.prisma.trip.update({
        where: { id: trip.id },
        data: { routeVersion: (trip.routeVersion ?? 1) + 1 },
      }),
    ]);
  
    await this.eventLogService.logEvent(tenantId, "Trip", tripId, "TRIP_ROUTE_OPTIMIZED", {
      waypointOrder,
    });
  
    return { ok: true, waypointOrder, polyline };
  }

}

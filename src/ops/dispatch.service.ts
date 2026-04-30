import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Role, TripDocumentType, TripStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseService } from "../auth/supabase.service";
import {
  DispatchOptimiseRouteDto,
  DispatchReorderTripsDto,
} from "./dto/dispatch.dto";

const JOB_DOCUMENTS_BUCKET = "job-documents";

@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
  ) {}

  private toLocalDayKey(value: Date | null | undefined): string | null {
    if (!value) return null;
    const year = value.getFullYear();
    const month = `${value.getMonth() + 1}`.padStart(2, "0");
    const day = `${value.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private isOpenStatus(status: TripStatus): boolean {
    return status !== TripStatus.COMPLETED
      && status !== TripStatus.DONE
      && status !== TripStatus.CANCELLED;
  }

  private async createSignedUrl(storageKey: string): Promise<string | null> {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase.storage
      .from(JOB_DOCUMENTS_BUCKET)
      .createSignedUrl(storageKey, 60 * 60);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  private async toBoardTrip(
    trip: any,
    trailerLocationMap: Map<string, string>,
  ) {
    const startPhoto = (trip.documents ?? []).find(
      (d: any) => d.type === TripDocumentType.TRAILER_START_PHOTO,
    );
    const endPhoto = (trip.documents ?? []).find(
      (d: any) => d.type === TripDocumentType.TRAILER_END_PHOTO,
    );
    return {
      id: trip.id,
      jobId: trip.jobId,
      jobInternalRef: trip.job?.internalRef ?? null,
      customerName: trip.job?.customerCompany?.name ?? null,
      title: trip.title ?? trip.displayTitle ?? null,
      status: trip.status,
      plannedStartAt: trip.plannedStartAt,
      jobSequence: trip.jobSequence,
      tripSequence: trip.tripSequence,
      origin: trip.originLabel ?? null,
      destination: trip.destinationLabel ?? null,
      originLat: trip.originLat ?? null,
      originLng: trip.originLng ?? null,
      destinationLat: trip.destinationLat ?? null,
      destinationLng: trip.destinationLng ?? null,
      publishedAt: trip.publishedAt ?? null,
      startedAt: trip.startedAt ?? null,
      closedAt: trip.closedAt ?? null,
      trailerNumber: trip.trailerNumber ?? null,
      trailerLastLocationCode: trip.trailerLastLocationCode ?? null,
      trailerParkedAt: trip.trailerParkedAt ?? null,
      trailerParkingLat: trip.trailerParkingLat ?? null,
      trailerParkingLng: trip.trailerParkingLng ?? null,
      trailerLastLocationName: trip.trailerLastLocationCode
        ? trailerLocationMap.get(trip.trailerLastLocationCode) ?? null
        : null,
      trailerStartPhotoUrl: startPhoto ? await this.createSignedUrl(startPhoto.storageKey) : null,
      trailerEndPhotoUrl: endPhoto ? await this.createSignedUrl(endPhoto.storageKey) : null,
    };
  }

  async getBoard(tenantId: string) {
    const [driverUsers, locations, trips, trailerLocations] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId, role: Role.DRIVER },
        select: { id: true, name: true, phone: true },
      }),
      this.prisma.driverLocationLatest.findMany({
        where: { tenantId },
      }),
      this.prisma.trip.findMany({
        where: { tenantId, status: { notIn: [TripStatus.DRAFT] } },
        include: {
          job: {
            select: {
              id: true,
              internalRef: true,
              customerCompany: { select: { name: true } },
            },
          },
          documents: {
            where: {
              isActive: true,
              type: { in: [TripDocumentType.TRAILER_START_PHOTO, TripDocumentType.TRAILER_END_PHOTO] },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      }),
      this.prisma.masterTrailerLocation.findMany({ select: { code: true, name: true } }),
    ]);

    const trailerLocationMap = new Map<string, string>(
      trailerLocations.map((l) => [l.code, l.name]),
    );
    const locationMap = new Map<string, (typeof locations)[number]>(
      locations.map((l) => [l.driverUserId, l]),
    );

    const driverProfiles = await this.prisma.drivers.findMany({
      where: { tenantId, userId: { in: driverUsers.map((d) => d.id) } },
      select: {
        id: true,
        userId: true,
        assignedVehicle: { select: { plateNo: true } },
        assignedFleetVehicle: { select: { plateNo: true } },
      },
    });
    const profileMap = new Map<string, (typeof driverProfiles)[number]>(
      driverProfiles.map((d) => [d.userId ?? "", d]),
    );

    const ongoingTrips = trips.filter((t) => t.status === TripStatus.ONGOING);
    const unassignedTrips = trips.filter((t) => !t.assignedDriverUserId && this.isOpenStatus(t.status));

    const drivers = await Promise.all(driverUsers.map(async (driver) => {
      const driverTrips = trips
        .filter((t) => t.assignedDriverUserId === driver.id)
        .sort((a, b) => (a.tripSequence ?? 9999) - (b.tripSequence ?? 9999));
      const activeTrip = driverTrips.find((t) => t.status === TripStatus.ONGOING) ?? null;
      const latestLocation = locationMap.get(driver.id);
      const profile = profileMap.get(driver.id);

      return {
        driverUserId: driver.id,
        driverId: profile?.id ?? null,
        driverName: driver.name ?? null,
        phone: driver.phone ?? null,
        vehicle: profile?.assignedVehicle?.plateNo ?? profile?.assignedFleetVehicle?.plateNo ?? null,
        latestLocation: latestLocation
          ? {
              lat: latestLocation.lat,
              lng: latestLocation.lng,
              accuracy: latestLocation.accuracy,
              heading: latestLocation.heading,
              speed: latestLocation.speed,
              capturedAt: latestLocation.capturedAt,
            }
          : null,
        lastGpsAgeMinutes: latestLocation
          ? Math.max(
              0,
              Math.floor((Date.now() - new Date(latestLocation.capturedAt).getTime()) / 60000),
            )
          : null,
        activeTrip: activeTrip ? await this.toBoardTrip(activeTrip, trailerLocationMap) : null,
        todayTrips: await Promise.all(
          driverTrips.map((trip) => this.toBoardTrip(trip, trailerLocationMap)),
        ),
      };
    }));

    return {
      generatedAt: new Date().toISOString(),
      drivers,
      unassignedTrips: await Promise.all(
        unassignedTrips.map((trip) => this.toBoardTrip(trip, trailerLocationMap)),
      ),
      ongoingTrips: await Promise.all(
        ongoingTrips.map((trip) => this.toBoardTrip(trip, trailerLocationMap)),
      ),
    };
  }

  async reorderDriverTrips(
    tenantId: string,
    driverUserId: string,
    dto: DispatchReorderTripsDto,
  ) {
    const day = dto.date.slice(0, 10);
    const allOpenTrips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        assignedDriverUserId: driverUserId,
        status: { notIn: [TripStatus.COMPLETED, TripStatus.DONE, TripStatus.CANCELLED] },
      },
      select: { id: true, plannedStartAt: true, createdAt: true },
    });

    const dayTrips = allOpenTrips.filter(
      (trip) => this.toLocalDayKey(trip.plannedStartAt ?? trip.createdAt) === day,
    );
    const existingIds = new Set(dayTrips.map((t) => t.id));
    const requestedIds = dto.tripIdsInOrder ?? [];
    if (!requestedIds.length) {
      throw new BadRequestException("tripIdsInOrder is required");
    }

    if (requestedIds.some((id) => !existingIds.has(id)) || requestedIds.length !== existingIds.size) {
      throw new BadRequestException(
        "tripIdsInOrder must include exactly all open trip ids for this driver/day",
      );
    }

    await this.prisma.$transaction(
      requestedIds.map((tripId, index) =>
        this.prisma.trip.update({
          where: { id: tripId },
          data: {
            tripSequence: index + 1,
            jobSequence: index + 1,
          },
        })),
    );
    return { ok: true, tripIdsInOrder: requestedIds };
  }

  async optimiseRoute(
    tenantId: string,
    driverUserId: string,
    dto: DispatchOptimiseRouteDto,
  ) {
    const day = dto.date.slice(0, 10);
    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        assignedDriverUserId: driverUserId,
        status: { notIn: [TripStatus.COMPLETED, TripStatus.DONE, TripStatus.CANCELLED] },
      },
      select: {
        id: true,
        plannedStartAt: true,
        createdAt: true,
        originLat: true,
        originLng: true,
        destinationLat: true,
        destinationLng: true,
      },
    });
    const dayTrips = trips.filter((t) => this.toLocalDayKey(t.plannedStartAt ?? t.createdAt) === day);
    if (!dayTrips.length) throw new NotFoundException("No open trips found for this driver/day");

    const warnings: string[] = [];
    const available = [...dayTrips];
    const output: string[] = [];
    let current = dto.startLocation ? { lat: dto.startLocation.lat, lng: dto.startLocation.lng } : null;

    const distance = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
      const dx = a.lat - b.lat;
      const dy = a.lng - b.lng;
      return Math.sqrt(dx * dx + dy * dy);
    };

    while (available.length > 0) {
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let i = 0; i < available.length; i += 1) {
        const trip = available[i];
        if (current && trip.originLat != null && trip.originLng != null) {
          const d = distance(current, { lat: trip.originLat, lng: trip.originLng });
          if (d < bestDistance) {
            bestDistance = d;
            bestIndex = i;
          }
        } else if (!current) {
          bestIndex = 0;
          break;
        }
      }

      const [nextTrip] = available.splice(bestIndex, 1);
      output.push(nextTrip.id);
      if (nextTrip.destinationLat != null && nextTrip.destinationLng != null) {
        current = { lat: nextTrip.destinationLat, lng: nextTrip.destinationLng };
      } else {
        warnings.push(`Trip ${nextTrip.id} missing destination coordinates`);
      }
      if (nextTrip.originLat == null || nextTrip.originLng == null) {
        warnings.push(`Trip ${nextTrip.id} missing origin coordinates`);
      }
    }

    return {
      suggestedTripIdsInOrder: output,
      reason: "Deterministic nearest-neighbour ordering using available origin/destination coordinates",
      warnings,
    };
  }
}

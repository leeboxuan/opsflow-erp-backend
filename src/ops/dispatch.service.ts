import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { MembershipStatus, Role, TripDocumentType, TripStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseService } from "../auth/supabase.service";
import {
  buildDocumentFileDisplayFields,
  documentMimeTypeOrNull,
} from "../common/document-file-display";
import {
  DispatchGpsStatus,
  DispatchRouteMode,
  DispatchRouteQueryDto,
  DispatchRouteResponseDto,
  DispatchOptimiseRouteDto,
  DispatchReorderTripsDto,
} from "./dto/dispatch.dto";

const JOB_DOCUMENTS_BUCKET = "job-documents";
const GOOGLE_ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

@Injectable()
export class DispatchService {
  private readonly dispatchRouteCache = new Map<string, {
    expiresAtMs: number;
    value: DispatchRouteResponseDto;
  }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
  ) {}

  private haversineMeters(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
    const toRad = (v: number) => (v * Math.PI) / 180;
    const r = 6371000;
    const dLat = toRad(toLat - fromLat);
    const dLng = toRad(toLng - fromLng);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private parseDurationSeconds(value: string | null | undefined): number | null {
    if (!value) return null;
    const trimmed = String(value).trim();
    const match = trimmed.match(/^(\d+(?:\.\d+)?)s$/);
    if (!match) return null;
    return Math.round(Number(match[1]));
  }

  private roundedCoord(value: number): string {
    return value.toFixed(5);
  }

  private buildDispatchRouteCacheKey(input: {
    fromLat: number;
    fromLng: number;
    toLat: number;
    toLng: number;
    mode: DispatchRouteMode;
    cacheKey?: string;
    tripId?: string;
  }): string {
    const mode = input.mode || DispatchRouteMode.DRIVE;
    const base = [
      mode,
      this.roundedCoord(input.fromLat),
      this.roundedCoord(input.fromLng),
      this.roundedCoord(input.toLat),
      this.roundedCoord(input.toLng),
    ].join(":");
    if (input.cacheKey?.trim()) return `${base}:cache:${input.cacheKey.trim()}`;
    if (input.tripId?.trim()) return `${base}:trip:${input.tripId.trim()}`;
    return base;
  }

  private getRouteApiKey(): string | null {
    const key = process.env.GOOGLE_ROUTES_API_KEY?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim();
    return key || null;
  }

  private validateRouteInput(input: DispatchRouteQueryDto): void {
    const isFiniteNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v);
    if (!isFiniteNumber(input.fromLat) || !isFiniteNumber(input.fromLng)
      || !isFiniteNumber(input.toLat) || !isFiniteNumber(input.toLng)) {
      throw new BadRequestException("fromLat, fromLng, toLat, toLng are required numbers");
    }
    if (input.fromLat < -90 || input.fromLat > 90 || input.toLat < -90 || input.toLat > 90) {
      throw new BadRequestException("Latitude must be between -90 and 90");
    }
    if (input.fromLng < -180 || input.fromLng > 180 || input.toLng < -180 || input.toLng > 180) {
      throw new BadRequestException("Longitude must be between -180 and 180");
    }
  }

  async getDispatchRoute(
    tenantId: string,
    input: DispatchRouteQueryDto,
  ): Promise<DispatchRouteResponseDto> {
    this.validateRouteInput(input);
    const mode = input.mode ?? DispatchRouteMode.DRIVE;
    const tinyDistance = this.haversineMeters(input.fromLat, input.fromLng, input.toLat, input.toLng);
    if (tinyDistance < 20) {
      return {
        provider: "GOOGLE_ROUTES",
        polyline: null,
        polylineEncoding: "ENCODED_POLYLINE",
        distanceMeters: 0,
        durationSeconds: 0,
        staticDurationSeconds: 0,
        routeLabels: [],
        cached: false,
      };
    }

    const cacheKey = this.buildDispatchRouteCacheKey({
      fromLat: input.fromLat,
      fromLng: input.fromLng,
      toLat: input.toLat,
      toLng: input.toLng,
      mode,
      cacheKey: input.cacheKey,
      tripId: input.tripId,
    });
    const now = Date.now();
    const cached = this.dispatchRouteCache.get(cacheKey);
    if (cached && cached.expiresAtMs > now) {
      return { ...cached.value, cached: true };
    }

    const apiKey = this.getRouteApiKey();
    if (!apiKey) {
      return {
        provider: "GOOGLE_ROUTES",
        polyline: null,
        polylineEncoding: "ENCODED_POLYLINE",
        distanceMeters: null,
        durationSeconds: null,
        staticDurationSeconds: null,
        routeLabels: [],
        cached: false,
        error: "Missing Google Routes API key",
      };
    }

    const body = {
      origin: {
        location: {
          latLng: {
            latitude: input.fromLat,
            longitude: input.fromLng,
          },
        },
      },
      destination: {
        location: {
          latLng: {
            latitude: input.toLat,
            longitude: input.toLng,
          },
        },
      },
      travelMode: mode,
      routingPreference: "TRAFFIC_AWARE",
      computeAlternativeRoutes: false,
      polylineQuality: "OVERVIEW",
      polylineEncoding: "ENCODED_POLYLINE",
    };

    try {
      const response = await fetch(GOOGLE_ROUTES_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline,routes.routeLabels",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        const result: DispatchRouteResponseDto = {
          provider: "GOOGLE_ROUTES",
          polyline: null,
          polylineEncoding: "ENCODED_POLYLINE",
          distanceMeters: null,
          durationSeconds: null,
          staticDurationSeconds: null,
          routeLabels: [],
          cached: false,
          error: `Google Routes error ${response.status}`,
        };
        console.error("dispatch.routes google_error", {
          tenantId,
          status: response.status,
          body: text?.slice(0, 500),
        });
        return result;
      }

      const payload = await response.json() as any;
      const route = payload?.routes?.[0];
      const result: DispatchRouteResponseDto = {
        provider: "GOOGLE_ROUTES",
        polyline: route?.polyline?.encodedPolyline ?? null,
        polylineEncoding: "ENCODED_POLYLINE",
        distanceMeters: Number.isFinite(route?.distanceMeters) ? route.distanceMeters : null,
        durationSeconds: this.parseDurationSeconds(route?.duration),
        staticDurationSeconds: this.parseDurationSeconds(route?.staticDuration),
        routeLabels: Array.isArray(route?.routeLabels) ? route.routeLabels : [],
        cached: false,
      };
      this.dispatchRouteCache.set(cacheKey, {
        expiresAtMs: now + 60_000,
        value: result,
      });
      return result;
    } catch (error: any) {
      console.error("dispatch.routes fetch_failed", {
        tenantId,
        message: error?.message ?? "unknown",
      });
      return {
        provider: "GOOGLE_ROUTES",
        polyline: null,
        polylineEncoding: "ENCODED_POLYLINE",
        distanceMeters: null,
        durationSeconds: null,
        staticDurationSeconds: null,
        routeLabels: [],
        cached: false,
        error: "Failed to compute route",
      };
    }
  }

  async getTripRoute(
    tenantId: string,
    tripId: string,
  ): Promise<DispatchRouteResponseDto> {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, status: { not: TripStatus.DRAFT } },
      select: {
        id: true,
        originLat: true,
        originLng: true,
        destinationLat: true,
        destinationLng: true,
      },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    if (
      trip.originLat == null
      || trip.originLng == null
      || trip.destinationLat == null
      || trip.destinationLng == null
    ) {
      throw new BadRequestException("Trip is missing route coordinates");
    }
    return this.getDispatchRoute(tenantId, {
      fromLat: trip.originLat,
      fromLng: trip.originLng,
      toLat: trip.destinationLat,
      toLng: trip.destinationLng,
      mode: DispatchRouteMode.DRIVE,
      tripId: trip.id,
    });
  }

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

  private toSelectedDateStart(value: string): Date {
    return new Date(`${value}T00:00:00.000`);
  }

  private async createSignedUrl(storageKey: string | null | undefined): Promise<string | null> {
    if (!storageKey) return null;
    try {
      const supabase = this.supabaseService.getClient();
      const { data, error } = await supabase.storage
        .from(JOB_DOCUMENTS_BUCKET)
        .createSignedUrl(storageKey, 60 * 60);
      if (error) return null;
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
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
    const startUrl = startPhoto ? await this.createSignedUrl(startPhoto.storageKey) : null;
    const endUrl = endPhoto ? await this.createSignedUrl(endPhoto.storageKey) : null;
    const startMeta = startPhoto
      ? {
          fileUrl: startUrl,
          ...buildDocumentFileDisplayFields(startPhoto),
          mimeType: documentMimeTypeOrNull(startPhoto.mimeType),
        }
      : null;
    const endMeta = endPhoto
      ? {
          fileUrl: endUrl,
          ...buildDocumentFileDisplayFields(endPhoto),
          mimeType: documentMimeTypeOrNull(endPhoto.mimeType),
        }
      : null;
    return {
      id: trip.id,
      jobId: trip.jobId,
      jobInternalRef: trip.job?.internalRef ?? null,
      jobRef: trip.job?.internalRef ?? null,
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
      trailerStartPhotoUrl: startUrl,
      trailerEndPhotoUrl: endUrl,
      trailerStartPhoto: startMeta,
      trailerEndPhoto: endMeta,
    };
  }

  async getBoard(tenantId: string, date?: string) {
    const selectedDate = (date && /^\d{4}-\d{2}-\d{2}$/.test(date))
      ? date
      : this.toLocalDayKey(new Date())!;
    const selectedDateStart = this.toSelectedDateStart(selectedDate);
    const [driverMemberships, locations, trips, trailerLocations] = await Promise.all([
      this.prisma.tenantMembership.findMany({
        where: {
          tenantId,
          role: Role.DRIVER,
          status: MembershipStatus.Active,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
        },
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
      this.prisma.masterTrailerLocation
        .findMany({ select: { code: true, name: true } })
        .catch(() => []),
    ]);

    const driverUsers = driverMemberships
      .map((membership) => membership.user)
      .filter(Boolean);

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

    const selectedDateTrips = trips.filter(
      (trip) => this.toLocalDayKey(trip.plannedStartAt ?? trip.createdAt) === selectedDate,
    );
    const ongoingTrips = selectedDateTrips.filter((t) => t.status === TripStatus.ONGOING);
    const unassignedTrips = selectedDateTrips.filter(
      (t) => !t.assignedDriverUserId && this.isOpenStatus(t.status),
    );

    const drivers = await Promise.all(driverUsers.map(async (driver) => {
      const driverTrips = selectedDateTrips
        .filter((t) => t.assignedDriverUserId === driver.id)
        .sort((a, b) => (a.tripSequence ?? 9999) - (b.tripSequence ?? 9999));
      const activeTrip = driverTrips.find((t) => t.status === TripStatus.ONGOING) ?? null;
      const latestLocation = locationMap.get(driver.id);
      const profile = profileMap.get(driver.id);
      const gpsRefAtRaw = latestLocation
        ? (
          latestLocation.recordedAt
          ?? latestLocation.capturedAt
          ?? latestLocation.updatedAt
          ?? latestLocation.createdAt
        )
        : null;
      const gpsRefAt = gpsRefAtRaw ? new Date(gpsRefAtRaw) : null;
      const gpsIsOnOrAfterSelectedDay = gpsRefAt != null && gpsRefAt.getTime() >= selectedDateStart.getTime();
      const lastGpsAgeMinutes = gpsIsOnOrAfterSelectedDay && gpsRefAt
        ? Math.max(0, Math.floor((Date.now() - gpsRefAt.getTime()) / 60000))
        : null;
      const lastMovedAtRaw = latestLocation?.lastMovedAt ?? null;
      const lastMovedAt = lastMovedAtRaw ? new Date(lastMovedAtRaw) : null;
      const stationaryMinutes = gpsIsOnOrAfterSelectedDay
        ? Math.max(
            0,
            Math.floor((Date.now() - (lastMovedAt?.getTime() ?? gpsRefAt?.getTime() ?? Date.now())) / 60000),
          )
        : null;
      let gpsStatus: DispatchGpsStatus;
      if (!latestLocation || !gpsIsOnOrAfterSelectedDay || lastGpsAgeMinutes == null) {
        gpsStatus = DispatchGpsStatus.NO_GPS;
      } else if (lastGpsAgeMinutes <= 2 && (stationaryMinutes ?? 0) >= 10) {
        gpsStatus = DispatchGpsStatus.IDLE;
      } else if (lastGpsAgeMinutes <= 2) {
        gpsStatus = DispatchGpsStatus.LIVE;
      } else if (lastGpsAgeMinutes <= 10) {
        gpsStatus = DispatchGpsStatus.STALE;
      } else {
        gpsStatus = DispatchGpsStatus.NO_GPS;
      }

      return {
        driverUserId: driver.id,
        driverId: profile?.id ?? null,
        driverName: driver.name ?? null,
        phone: driver.phone ?? null,
        driverPhone: driver.phone ?? null,
        vehicle: profile?.assignedVehicle?.plateNo ?? profile?.assignedFleetVehicle?.plateNo ?? null,
        vehicleNumber: profile?.assignedVehicle?.plateNo ?? profile?.assignedFleetVehicle?.plateNo ?? null,
        latestLocation: latestLocation
          ? {
              lat: latestLocation.lat,
              lng: latestLocation.lng,
              accuracy: latestLocation.accuracy,
              heading: latestLocation.heading,
              speed: latestLocation.speed,
              capturedAt: latestLocation.capturedAt,
              recordedAt: latestLocation.recordedAt ?? latestLocation.capturedAt ?? null,
              updatedAt: latestLocation.updatedAt ?? null,
              lastMovedAt: latestLocation.lastMovedAt ?? null,
            }
          : null,
        lastGpsAgeMinutes,
        stationaryMinutes,
        gpsStatus,
        activeTrip: activeTrip ? await this.toBoardTrip(activeTrip, trailerLocationMap) : null,
        todayTrips: await Promise.all(
          driverTrips.map((trip) => this.toBoardTrip(trip, trailerLocationMap)),
        ),
        trips: await Promise.all(
          driverTrips.map((trip) => this.toBoardTrip(trip, trailerLocationMap)),
        ),
      };
    }));

    return {
      generatedAt: new Date().toISOString(),
      date: selectedDate,
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
    const requestedTrips = requestedIds.length
      ? await this.prisma.trip.findMany({
          where: {
            tenantId,
            assignedDriverUserId: driverUserId,
            id: { in: requestedIds },
          },
          select: { id: true, status: true },
        })
      : [];
    const terminalRequested = requestedTrips.filter((trip) =>
      trip.status === TripStatus.COMPLETED
      || trip.status === TripStatus.DONE
      || trip.status === TripStatus.CANCELLED
    );
    if (terminalRequested.length > 0) {
      throw new BadRequestException(
        "tripIdsInOrder contains terminal trips (COMPLETED/DONE/CANCELLED) and cannot be reordered",
      );
    }

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

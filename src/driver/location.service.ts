import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parsePaginationFromQuery, buildPaginationMeta } from '../common/pagination';
import { buildOrderBy } from '../common/listing/listing.sort';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationDto, DriverLocationDto } from './dto/location.dto';
import { RealtimeEventsService } from '../realtime/realtime-events.service';

@Injectable()
export class LocationService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly realtime?: RealtimeEventsService,
  ) {}

  private distanceMeters(
    aLat: number,
    aLng: number,
    bLat: number,
    bLng: number,
  ): number {
    const toRadians = (v: number) => (v * Math.PI) / 180;
    const earthRadiusMeters = 6371000;
    const dLat = toRadians(bLat - aLat);
    const dLng = toRadians(bLng - aLng);
    const lat1 = toRadians(aLat);
    const lat2 = toRadians(bLat);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  async upsertLocation(
    tenantId: string,
    driverUserId: string,
    dto: UpdateLocationDto,
  ): Promise<LocationDto> {
    const recordedAt = dto.recordedAt ? new Date(dto.recordedAt) : new Date();
    // Verify driver belongs to tenant
    const membership = await (this.prisma as any).tenantMembership.findFirst({
      where: {
        tenantId,
        userId: driverUserId,
      },
    });

    if (!membership) {
      throw new NotFoundException(
        'Driver not found or not a member of this tenant',
      );
    }

    const existing = await (this.prisma as any).driverLocationLatest.findUnique({
      where: {
        tenantId_driverUserId: {
          tenantId,
          driverUserId,
        },
      },
    });

    const movedMeters = existing
      ? this.distanceMeters(existing.lat, existing.lng, dto.lat, dto.lng)
      : Number.POSITIVE_INFINITY;
    const hasMovedMeaningfully = movedMeters >= 50;
    const lastMovedAt = hasMovedMeaningfully
      ? recordedAt
      : (existing?.lastMovedAt ?? null);
    const lastMovedLat = hasMovedMeaningfully
      ? dto.lat
      : (existing?.lastMovedLat ?? null);
    const lastMovedLng = hasMovedMeaningfully
      ? dto.lng
      : (existing?.lastMovedLng ?? null);

    // Upsert latest location
    const location = await (this.prisma as any).driverLocationLatest.upsert({
      where: {
        tenantId_driverUserId: {
          tenantId,
          driverUserId,
        },
      },
      update: {
        lat: dto.lat,
        lng: dto.lng,
        accuracy: dto.accuracy ?? null,
        heading: dto.heading ?? null,
        speed: dto.speed ?? null,
        recordedAt,
        capturedAt: recordedAt,
        lastMovedAt,
        lastMovedLat,
        lastMovedLng,
      },
      create: {
        tenantId,
        driverUserId,
        lat: dto.lat,
        lng: dto.lng,
        accuracy: dto.accuracy ?? null,
        heading: dto.heading ?? null,
        speed: dto.speed ?? null,
        recordedAt,
        capturedAt: recordedAt,
        lastMovedAt: recordedAt,
        lastMovedLat: dto.lat,
        lastMovedLng: dto.lng,
      },
    });

    this.realtime?.publishDriverLocationUpdated(tenantId, driverUserId);

    return this.toLocationDto(location);
  }

  async getLatestLocation(
    tenantId: string,
    driverUserId: string,
  ): Promise<LocationDto | null> {
    const location = await (this.prisma as any).driverLocationLatest.findUnique({
      where: {
        tenantId_driverUserId: {
          tenantId,
          driverUserId,
        },
      },
    });

    if (!location) {
      return null;
    }

    return this.toLocationDto(location);
  }

  async getAllDriverLocations(
    tenantId: string,
    query?: { q?: string; filter?: string; sortBy?: string; sortDir?: string; page?: unknown; pageSize?: unknown },
  ): Promise<{ data: DriverLocationDto[]; meta: { page: number; pageSize: number; total: number } }> {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query ?? {});

    const where: any = { tenantId };

    const orderBy = buildOrderBy(
      query?.sortBy,
      query?.sortDir,
      ["updatedAt", "capturedAt"],
      { updatedAt: "desc" },
    );

    const [total, locations] = await (this.prisma as any).$transaction([
      (this.prisma as any).driverLocationLatest.count({ where }),
      (this.prisma as any).driverLocationLatest.findMany({
        where,
        orderBy,
        skip,
        take,
      }),
    ]);

    const locationsWithUsers = await Promise.all(
      locations.map(async (location: any) => {
        const membership = await (this.prisma as any).tenantMembership.findFirst({
          where: {
            tenantId,
            userId: location.driverUserId,
          },
          include: { user: true },
        });

        return {
          ...location,
          driverEmail: membership?.user.email || '',
          driverName: membership?.user.name || null,
        };
      }),
    );

    const data = locationsWithUsers.map((loc: any) => this.toDriverLocationDto(loc));
    return { data, meta: buildPaginationMeta(page, pageSize, total) };
  }

  private toLocationDto(location: any): LocationDto {
    return {
      driverUserId: location.driverUserId,
      lat: location.lat,
      lng: location.lng,
      accuracy: location.accuracy,
      heading: location.heading,
      speed: location.speed,
      capturedAt: location.capturedAt,
      recordedAt: location.recordedAt ?? location.capturedAt ?? null,
      lastMovedAt: location.lastMovedAt ?? null,
      updatedAt: location.updatedAt,
    };
  }

  private toDriverLocationDto(location: any): DriverLocationDto {
    return {
      driverUserId: location.driverUserId,
      driverEmail: location.driverEmail,
      driverName: location.driverName,
      lat: location.lat,
      lng: location.lng,
      accuracy: location.accuracy,
      heading: location.heading,
      speed: location.speed,
      capturedAt: location.capturedAt,
      recordedAt: location.recordedAt ?? location.capturedAt ?? null,
      lastMovedAt: location.lastMovedAt ?? null,
      updatedAt: location.updatedAt,
    };
  }
}

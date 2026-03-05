import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parsePaginationFromQuery, buildPaginationMeta } from '../common/pagination';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationDto, DriverLocationDto } from './dto/location.dto';

@Injectable()
export class LocationService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertLocation(
    tenantId: string,
    driverUserId: string,
    dto: UpdateLocationDto,
  ): Promise<LocationDto> {
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
        accuracy: dto.accuracy || null,
        heading: dto.heading || null,
        speed: dto.speed || null,
        capturedAt: new Date(),
      },
      create: {
        tenantId,
        driverUserId,
        lat: dto.lat,
        lng: dto.lng,
        accuracy: dto.accuracy || null,
        heading: dto.heading || null,
        speed: dto.speed || null,
        capturedAt: new Date(),
      },
    });

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
    query?: { page?: unknown; pageSize?: unknown },
  ): Promise<{ data: DriverLocationDto[]; meta: { page: number; pageSize: number; total: number } }> {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query ?? {});

    const where = { tenantId };

    const [total, locations] = await (this.prisma as any).$transaction([
      (this.prisma as any).driverLocationLatest.count({ where }),
      (this.prisma as any).driverLocationLatest.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
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
      updatedAt: location.updatedAt,
    };
  }
}

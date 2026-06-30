import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../shared/prisma/prisma.service';
import { UpdateStopDto } from './dto/update-stop.dto';
import { StopDto } from './dto/trip.dto';
import { EventLogService } from './event-log.service';

@Injectable()
export class StopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogService: EventLogService,
  ) {}

  async updateStop(
    tenantId: string,
    stopId: string,
    dto: UpdateStopDto,
  ): Promise<StopDto> {
    // Verify stop belongs to tenant (tenant scoped)
    const stop = await this.prisma.stop.findFirst({
      where: {
        id: stopId,
        tenantId,
      },
    });

    if (!stop) {
      throw new NotFoundException('Stop not found');
    }

    // Build update data, only including provided fields
    const updateData: any = {};
    if (dto.addressLine1 !== undefined) {
      updateData.addressLine1 = dto.addressLine1;
    }
    if (dto.addressLine2 !== undefined) {
      updateData.addressLine2 = dto.addressLine2 || null;
    }
    if (dto.city !== undefined) {
      updateData.city = dto.city;
    }
    if (dto.postalCode !== undefined) {
      updateData.postalCode = dto.postalCode;
    }
    if (dto.country !== undefined) {
      updateData.country = dto.country;
    }
    if (dto.plannedAt !== undefined) {
      updateData.plannedAt = dto.plannedAt ? new Date(dto.plannedAt) : null;
    }

    // Update stop (tenantId already verified above)
    const updatedStop = await this.prisma.stop.update({
      where: {
        id: stopId,
      },
      data: updateData,
      include: {
        pods: {
          take: 1,
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    // Log event with payload including changed fields (input DTO)
    await this.eventLogService.logEvent(
      tenantId,
      'Stop',
      stopId,
      'STOP_UPDATED',
      dto,
    );

    return this.toDto(updatedStop);
  }

  private toDto(stop: any): StopDto {
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
    };
  }
}

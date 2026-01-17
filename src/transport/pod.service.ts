import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePodDto } from './dto/create-pod.dto';
import { PodDto } from './dto/trip.dto';
import { EventLogService } from './event-log.service';

@Injectable()
export class PodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogService: EventLogService,
  ) {}

  async createOrUpdatePod(
    tenantId: string,
    stopId: string,
    dto: CreatePodDto,
  ): Promise<PodDto> {
    // Verify stop belongs to tenant
    const stop = await this.prisma.stop.findFirst({
      where: {
        id: stopId,
        tenantId,
      },
    });

    if (!stop) {
      throw new NotFoundException('Stop not found');
    }

    // Check if POD already exists for this stop
    const existingPod = await this.prisma.pod.findFirst({
      where: {
        stopId,
        tenantId,
      },
    });

    // Determine status: use provided status, or Completed if signatureUrl provided, or default
    let podStatus = dto.status;
    if (!podStatus) {
      if (dto.signatureUrl || dto.signedBy) {
        podStatus = 'Completed' as any;
      } else {
        podStatus = 'Pending' as any;
      }
    }

    // Use signatureUrl as photoUrl if photoUrl not provided and signatureUrl is provided
    const photoUrlValue = dto.photoUrl || dto.signatureUrl || null;

    const pod = existingPod
      ? await this.prisma.pod.update({
          where: {
            id: existingPod.id,
          },
          data: {
            status: podStatus,
            signedBy: dto.signedBy || null,
            signedAt: dto.signedAt ? new Date(dto.signedAt) : new Date(),
            photoUrl: photoUrlValue,
          },
        })
      : await this.prisma.pod.create({
          data: {
            tenantId,
            stopId,
            status: podStatus,
            signedBy: dto.signedBy || null,
            signedAt: dto.signedAt ? new Date(dto.signedAt) : new Date(),
            photoUrl: photoUrlValue,
          },
        });

    // Log event with note and signatureUrl in payload
    await this.eventLogService.logEvent(
      tenantId,
      'Stop',
      stopId,
      'POD_UPDATED',
      {
        podId: pod.id,
        status: pod.status,
        signedBy: pod.signedBy,
        signatureUrl: dto.signatureUrl,
        note: dto.note,
      },
    );

    return this.toDto(pod);
  }

  private toDto(pod: any): PodDto {
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
}

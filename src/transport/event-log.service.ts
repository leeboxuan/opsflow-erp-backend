import { Injectable } from '@nestjs/common';
import { PrismaService } from '../shared/prisma/prisma.service';

@Injectable()
export class EventLogService {
  constructor(private readonly prisma: PrismaService) {}

  async logEvent(
    tenantId: string,
    entityType: 'Order' | 'Trip' | 'Stop',
    entityId: string,
    eventType: string,
    payload?: Record<string, any>,
  ): Promise<void> {
    await this.prisma.eventLog.create({
      data: {
        tenantId,
        entityType,
        entityId,
        eventType,
        payload: payload ? payload : null,
      },
    });
  }
}

import { Injectable } from '@nestjs/common';
import {
  Prisma,
  WarehouseJobEventType,
  WarehouseJobStatus,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';

export type WarehouseJobDbClient = PrismaService | Prisma.TransactionClient;

export interface AppendWarehouseJobEventInput {
  tenantId: string;
  warehouseJobId: string;
  eventType: WarehouseJobEventType;
  actorUserId?: string | null;
  fromStatus?: WarehouseJobStatus | null;
  toStatus?: WarehouseJobStatus | null;
  payload?: Prisma.InputJsonValue;
}

@Injectable()
export class WarehouseJobEventsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append an immutable audit event. Pass a transaction client when called inside $transaction.
   */
  async append(
    client: WarehouseJobDbClient,
    input: AppendWarehouseJobEventInput,
  ) {
    return client.warehouseJobEvent.create({
      data: {
        tenantId: input.tenantId,
        warehouseJobId: input.warehouseJobId,
        actorUserId: input.actorUserId ?? null,
        eventType: input.eventType,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        payload: input.payload ?? undefined,
      },
    });
  }
}

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "STATUS_CHANGE"
  | "ASSIGN"
  | "CANCEL"
  | "DELETE"
  | "UPLOAD_DOC"
  | "DRIVER_START"
  | "DRIVER_COMPLETE"
  | "DEPOT_VERIFY";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    tenantId: string,
    action: AuditAction | string,
    entityType: string,
    entityId: string,
    metadata?: Record<string, unknown>,
    actorUserId?: string | null,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorUserId: actorUserId ?? null,
        entityType,
        entityId,
        action,
        metadata: metadata ? (metadata as object) : null,
      },
    });
  }

  async findByEntity(
    tenantId: string,
    entityType: string,
    entityId: string,
    limit = 100,
  ) {
    return this.prisma.auditLog.findMany({
      where: { tenantId, entityType, entityId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}

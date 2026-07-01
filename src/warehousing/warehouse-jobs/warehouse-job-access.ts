import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, Role, WarehouseJobStatus } from '@prisma/client';

const WAREHOUSE_QUEUE_STATUSES: WarehouseJobStatus[] = [
  WarehouseJobStatus.OPEN,
  WarehouseJobStatus.IN_PROGRESS,
];

const TERMINAL_STATUSES = new Set<WarehouseJobStatus>([
  WarehouseJobStatus.COMPLETED,
  WarehouseJobStatus.CANCELLED,
]);

export type WarehouseJobAccessRef = {
  id: string;
  status: WarehouseJobStatus;
  assignedToUserId: string | null;
};

export function isOpsLikeRole(role: Role): boolean {
  return role === Role.ADMIN || role === Role.OPS || role === Role.FINANCE;
}

/**
 * WAREHOUSE v1 access policy:
 * - Assigned job: only assignedToUserId may access.
 * - Unassigned job: OPEN/IN_PROGRESS queue visible to any WAREHOUSE user in tenant.
 */
export function assertWarehouseUserCanAccessJob(
  job: WarehouseJobAccessRef,
  userId: string | undefined,
): void {
  if (!userId) {
    throw new ForbiddenException('User context required');
  }

  if (job.assignedToUserId) {
    if (job.assignedToUserId !== userId) {
      throw new ForbiddenException(
        'Warehouse job is assigned to another user',
      );
    }
    return;
  }

  if (!WAREHOUSE_QUEUE_STATUSES.includes(job.status)) {
    throw new ForbiddenException(
      'Warehouse job is not available in the open queue',
    );
  }
}

export function buildWarehouseUserListWhere(
  tenantId: string,
  userId: string,
): Prisma.WarehouseJobWhereInput {
  return {
    tenantId,
    OR: [
      { assignedToUserId: userId },
      {
        assignedToUserId: null,
        status: { in: WAREHOUSE_QUEUE_STATUSES },
      },
    ],
  };
}

export function assertJobAllowsExecutionUpdate(status: WarehouseJobStatus): void {
  if (TERMINAL_STATUSES.has(status)) {
    throw new BadRequestException(
      `Cannot update execution when warehouse job status is ${status}`,
    );
  }
}

export function mapRoleToDocumentSource(role: Role): 'ADMIN' | 'OPS' | 'WAREHOUSE' {
  if (role === Role.ADMIN) return 'ADMIN';
  if (role === Role.WAREHOUSE) return 'WAREHOUSE';
  return 'OPS';
}

export const WAREHOUSE_UPLOAD_TYPES = new Set([
  'WAREHOUSE_PHOTO',
  'DAMAGE_PHOTO',
  'COMPLETION_PHOTO',
  'OTHER',
]);

export const ADMIN_OPS_ONLY_UPLOAD_TYPES = new Set([
  'PACKING_LIST',
  'DELIVERY_ORDER',
  'INSTRUCTION',
  'REFERENCE_PHOTO',
]);

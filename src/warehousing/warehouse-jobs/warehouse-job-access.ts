import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, Role, WarehouseJobStatus } from '@prisma/client';
import { isTransportStaffRole } from '../../shared/auth/role-compat';

const TERMINAL_STATUSES = new Set<WarehouseJobStatus>([
  WarehouseJobStatus.COMPLETED,
  WarehouseJobStatus.CANCELLED,
]);

export type WarehouseJobAccessRef = {
  id: string;
  status: WarehouseJobStatus;
  assignedToUserId: string | null;
};

/** Admin / transport staff / finance — office roles for warehouse job access. */
export function isOpsLikeRole(role: Role): boolean {
  return (
    role === Role.ADMIN ||
    isTransportStaffRole(role) ||
    role === Role.FINANCE
  );
}

/**
 * WAREHOUSE access policy:
 * - Any active WAREHOUSE user in the tenant may view and work all tenant warehouse jobs.
 * - assignedToUserId is PIC metadata only — not a visibility ACL.
 */
export function assertWarehouseUserCanAccessJob(
  _job: WarehouseJobAccessRef,
  userId: string | undefined,
): void {
  if (!userId) {
    throw new ForbiddenException('User context required');
  }
}

export function buildWarehouseUserListWhere(
  tenantId: string,
  _userId: string,
): Prisma.WarehouseJobWhereInput {
  return { tenantId };
}

export function assertJobAllowsExecutionUpdate(status: WarehouseJobStatus): void {
  if (TERMINAL_STATUSES.has(status)) {
    throw new BadRequestException(
      `Cannot update execution when warehouse job status is ${status}`,
    );
  }
}

export function assertJobAllowsFloorMutation(status: WarehouseJobStatus): void {
  if (TERMINAL_STATUSES.has(status)) {
    throw new BadRequestException(
      `Cannot modify warehouse job when status is ${status}`,
    );
  }
}

/**
 * Maps membership role → warehouse document provenance.
 * Transport staff (including deprecated OPS) still store source `OPS` until a
 * separate domain-neutral migration (proposed: OFFICE) is approved.
 */
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

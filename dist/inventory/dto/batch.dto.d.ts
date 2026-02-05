import { InventoryBatchStatus } from '@prisma/client';
export declare class BatchDto {
    id: string;
    batchCode: string;
    customerName?: string | null;
    customerRef?: string | null;
    receivedAt?: Date | null;
    notes?: string | null;
    status: InventoryBatchStatus;
    createdAt: Date;
    updatedAt: Date;
    totalUnits: number;
    availableUnits: number;
    reservedUnits: number;
    inTransitUnits: number;
    deliveredUnits: number;
}

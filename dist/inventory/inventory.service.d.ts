import { PrismaService } from '../prisma/prisma.service';
import { InventoryBatchStatus } from '@prisma/client';
import { CreateBatchDto } from './dto/create-batch.dto';
import { ReceiveUnitsDto } from './dto/receive-units.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { ReserveItemsDto } from './dto/reserve-items.dto';
import { DispatchItemsDto } from './dto/dispatch-items.dto';
import { DeliverItemsDto } from './dto/deliver-items.dto';
import { BatchDto } from './dto/batch.dto';
import { InventoryItemDto } from './dto/inventory-item.dto';
export declare class InventoryService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    private updateAvailableQty;
    getItemsSummary(tenantId: string, search?: string): Promise<Array<{
        id: string;
        sku: string;
        name: string;
        reference: string | null;
        counts: {
            available: number;
            reserved: number;
            inTransit: number;
            delivered: number;
            total: number;
        };
    }>>;
    searchItems(tenantId: string, search?: string): Promise<InventoryItemDto[]>;
    createBatch(tenantId: string, dto: CreateBatchDto): Promise<BatchDto>;
    receiveStock(tenantId: string, batchId: string, dto: ReceiveStockDto): Promise<{
        items: Array<{
            inventoryItemId: string;
            sku: string;
            name: string;
            receivedQty: number;
            totalInBatch: number;
        }>;
        totalUnitsCreated: number;
    }>;
    private getNextItemSeqForTenant;
    getBatchSummary(tenantId: string, batchId: string): Promise<{
        id: string;
        batchCode: string;
        status: InventoryBatchStatus;
        items: Array<{
            inventoryItemId: string;
            sku: string;
            name: string;
            counts: {
                available: number;
                reserved: number;
                inTransit: number;
                delivered: number;
                total: number;
            };
        }>;
    }>;
    receiveUnits(tenantId: string, batchId: string, dto: ReceiveUnitsDto): Promise<{
        batchId: string;
        unitsCreated: number;
        unitSkus: string[];
    }>;
    listBatches(tenantId: string, customerName?: string, status?: InventoryBatchStatus): Promise<BatchDto[]>;
    getBatchById(tenantId: string, batchId: string): Promise<BatchDto>;
    reserveItems(tenantId: string, orderId: string, dto: ReserveItemsDto): Promise<{
        reserved: number;
        items: Array<{
            inventorySku: string;
            qty: number;
            unitSkus: string[];
        }>;
    }>;
    dispatchItems(tenantId: string, orderId: string, dto: DispatchItemsDto): Promise<{
        dispatched: number;
    }>;
    deliverItems(tenantId: string, orderId: string, dto: DeliverItemsDto): Promise<{
        delivered: number;
    }>;
    cancelReservation(tenantId: string, orderId: string): Promise<{
        released: number;
    }>;
    private getBatchCounts;
    private toBatchDto;
    private generateId;
}

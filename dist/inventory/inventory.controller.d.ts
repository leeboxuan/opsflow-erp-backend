import { InventoryService } from './inventory.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { ReserveItemsDto } from './dto/reserve-items.dto';
import { DispatchItemsDto } from './dto/dispatch-items.dto';
import { DeliverItemsDto } from './dto/deliver-items.dto';
import { BatchDto } from './dto/batch.dto';
import { InventoryItemDto } from './dto/inventory-item.dto';
declare const BATCH_STATUS_VALUES: readonly ["Draft", "Open", "Completed", "Cancelled"];
type BatchStatusQuery = (typeof BATCH_STATUS_VALUES)[number];
export declare class InventoryController {
    private readonly inventoryService;
    constructor(inventoryService: InventoryService);
    getItemsSummary(req: any, search?: string): Promise<Array<{
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
    getItems(req: any, search?: string): Promise<InventoryItemDto[]>;
    createBatch(req: any, dto: CreateBatchDto): Promise<BatchDto>;
    receiveStock(req: any, batchId: string, dto: ReceiveStockDto): Promise<{
        items: Array<{
            inventoryItemId: string;
            sku: string;
            name: string;
            receivedQty: number;
            totalInBatch: number;
        }>;
        totalUnitsCreated: number;
    }>;
    getBatchSummary(req: any, batchId: string): Promise<{
        id: string;
        batchCode: string;
        status: string;
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
    listBatches(req: any, customerName?: string, status?: BatchStatusQuery): Promise<BatchDto[]>;
    getBatch(req: any, batchId: string): Promise<BatchDto>;
    reserveItems(req: any, orderId: string, dto: ReserveItemsDto): Promise<{
        reserved: number;
        items: Array<{
            inventorySku: string;
            qty: number;
            unitSkus: string[];
        }>;
    }>;
    dispatchItems(req: any, orderId: string, dto: DispatchItemsDto): Promise<{
        dispatched: number;
    }>;
    deliverItems(req: any, orderId: string, dto: DeliverItemsDto): Promise<{
        delivered: number;
    }>;
    cancelReservation(req: any, orderId: string): Promise<{
        released: number;
    }>;
}
export {};

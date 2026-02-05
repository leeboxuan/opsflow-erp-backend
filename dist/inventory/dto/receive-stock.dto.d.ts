export declare class ReceiveStockItemDto {
    inventoryItemId: string;
    quantity: number;
}
export declare class ReceiveStockDto {
    items: ReceiveStockItemDto[];
    unitSkuFormat?: 'ITEM-BATCH-SEQ' | 'ITEM-SEQ';
}

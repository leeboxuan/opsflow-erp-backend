import { StopType } from '@prisma/client';
export declare class CreateOrderStopDto {
    type: StopType;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    postalCode: string;
    country: string;
    plannedAt?: string;
}
export declare class CreateOrderItemDto {
    inventoryItemId: string;
    quantity: number;
    batchId?: string;
}
export declare class CreateOrderDto {
    orderRef: string;
    customerName: string;
    stops: CreateOrderStopDto[];
    items?: CreateOrderItemDto[];
}

import { OrderStatus, StopType, PodStatus } from '@prisma/client';
export interface StopDto {
    id: string;
    sequence: number;
    type: StopType;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    postalCode: string;
    country: string;
    plannedAt: Date | null;
    transportOrderId: string | null;
    createdAt: Date;
    updatedAt: Date;
    pod?: PodDto | null;
}
export interface PodDto {
    id: string;
    status: PodStatus;
    signedBy: string | null;
    signedAt: Date | null;
    photoUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface OrderDto {
    id: string;
    orderRef: string;
    customerRef: string;
    customerName: string | null;
    status: OrderStatus;
    pickupWindowStart: Date | null;
    pickupWindowEnd: Date | null;
    deliveryWindowStart: Date | null;
    deliveryWindowEnd: Date | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    stops?: StopDto[];
}

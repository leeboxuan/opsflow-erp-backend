import { TripStatus, StopType, StopStatus, OrderStatus } from '@prisma/client';
export interface DeliveryOrderSummaryDto {
    id: string;
    customerRef: string;
    status: OrderStatus;
}
export interface DriverStopDto {
    id: string;
    sequence: number;
    type: StopType;
    status: StopStatus;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    postalCode: string;
    country: string;
    plannedAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    transportOrderId: string | null;
    deliveryOrder?: DeliveryOrderSummaryDto | null;
    podPhotoKeys: string[];
    createdAt: Date;
    updatedAt: Date;
}
export interface TripLockStateDto {
    canStartTrip: boolean;
    canStartStopId: string | null;
    nextStopSequence: number;
    allStopsCompleted: boolean;
}
export interface DriverTripDto {
    id: string;
    status: TripStatus;
    plannedStartAt: Date | null;
    plannedEndAt: Date | null;
    assignedDriverId: string | null;
    assignedVehicleId: string | null;
    trailerNo: string | null;
    startedAt: Date | null;
    closedAt: Date | null;
    stops: DriverStopDto[];
    lockState: TripLockStateDto;
    createdAt: Date;
    updatedAt: Date;
}
export interface DriverWalletTransactionDto {
    id: string;
    tripId: string;
    amountCents: number;
    currency: string;
    type: string;
    description: string | null;
    createdAt: Date;
}
export interface DriverWalletDto {
    month: string;
    transactions: DriverWalletTransactionDto[];
    totalCents: number;
}

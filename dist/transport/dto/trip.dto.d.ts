import { TripStatus, StopType, PodStatus } from '@prisma/client';
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
export interface VehicleInfoDto {
    id: string;
    vehicleNumber: string;
    type: string | null;
}
export interface DriverInfoDto {
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
}
export interface TripDto {
    id: string;
    status: TripStatus;
    plannedStartAt: Date | null;
    plannedEndAt: Date | null;
    assignedDriverId: string | null;
    assignedVehicleId: string | null;
    assignedDriver?: DriverInfoDto | null;
    assignedVehicle?: VehicleInfoDto | null;
    createdAt: Date;
    updatedAt: Date;
    stops: StopDto[];
}

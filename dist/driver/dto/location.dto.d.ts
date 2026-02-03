export declare class LocationDto {
    driverUserId: string;
    lat: number;
    lng: number;
    accuracy: number | null;
    heading: number | null;
    speed: number | null;
    capturedAt: Date;
    updatedAt: Date;
}
export declare class DriverLocationDto extends LocationDto {
    driverName: string | null;
    driverEmail: string;
}

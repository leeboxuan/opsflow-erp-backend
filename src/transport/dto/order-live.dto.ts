export interface OrderLiveDto {
    orderId: string;
    tripId: string | null;
    driverUserId: string | null;
    lat: number | null;
    lng: number | null;
    capturedAt: Date | null;
  }
  
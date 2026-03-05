import { VehicleType, VehicleStatus } from "@prisma/client";

export interface VehicleDto {
  id: string;
  tenantId: string;
  plateNo: string;
  type: VehicleType;
  status: VehicleStatus;
  vehicleDescription: string | null;
  driverId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListVehiclesResult {
  data: VehicleDto[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
  };
}

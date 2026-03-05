import { VehicleType, VehicleStatus } from "@prisma/client";
import type { PaginatedResponse } from "../common/pagination";

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

export type ListVehiclesResult = PaginatedResponse<VehicleDto>;

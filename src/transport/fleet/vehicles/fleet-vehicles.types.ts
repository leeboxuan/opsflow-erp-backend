import { VehicleStatus, VehicleType } from "@prisma/client";
import type { PaginatedResponse } from "../../../common/pagination";

export interface FleetVehicleDto {
  id: string;
  tenantId: string;
  plateNo: string;
  type: VehicleType;
  status: VehicleStatus;
  vehicleDescription: string | null;
  driverId: string | null;
  driver?: { id: string; name: string | null; email: string | null } | null;
  roadTaxExpiryDate: Date | null;
  lastServicingDate: Date | null;
  coeExpiryDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ListFleetVehiclesResult = PaginatedResponse<FleetVehicleDto>;

import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { VehicleStatus, VehicleType } from "@prisma/client";
import { SORT_DIR_VALUES } from "../../../../common/constants";

export const FLEET_VEHICLE_LIST_FILTER = {
  ALL: "all",
  ASSIGNED: "assigned",
  UNASSIGNED: "unassigned",
} as const;
export type FleetVehicleListFilter =
  (typeof FLEET_VEHICLE_LIST_FILTER)[keyof typeof FLEET_VEHICLE_LIST_FILTER];

export const FLEET_VEHICLE_SORT_FIELDS = [
  "createdAt",
  "updatedAt",
  "plateNo",
  "type",
  "status",
] as const;
export type FleetVehicleSortBy = (typeof FLEET_VEHICLE_SORT_FIELDS)[number];

export class ListFleetVehiclesQueryDto {
  @ApiPropertyOptional({ description: "Search: plateNo, type, or vehicleDescription (case-insensitive contains)" })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    enum: Object.values(FLEET_VEHICLE_LIST_FILTER),
    default: FLEET_VEHICLE_LIST_FILTER.ALL,
    description: "Filter by assignment: all | assigned | unassigned",
  })
  @IsOptional()
  @IsIn(Object.values(FLEET_VEHICLE_LIST_FILTER))
  filter?: FleetVehicleListFilter = FLEET_VEHICLE_LIST_FILTER.ALL;

  @ApiPropertyOptional({ enum: VehicleStatus })
  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;

  @ApiPropertyOptional({ enum: VehicleType })
  @IsOptional()
  @IsEnum(VehicleType)
  type?: VehicleType;

  @ApiPropertyOptional({ description: "Filter by assigned driver user id" })
  @IsOptional()
  @IsString()
  driverId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({
    enum: FLEET_VEHICLE_SORT_FIELDS,
    default: "createdAt",
    description: "Sort field",
  })
  @IsOptional()
  @IsIn(FLEET_VEHICLE_SORT_FIELDS)
  sortBy?: FleetVehicleSortBy = "createdAt";

  @ApiPropertyOptional({ enum: SORT_DIR_VALUES, default: "desc" })
  @IsOptional()
  @IsIn(SORT_DIR_VALUES)
  sortDir?: "asc" | "desc" = "desc";
}

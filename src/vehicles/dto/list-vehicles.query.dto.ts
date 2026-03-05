import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsEnum, IsInt, Min, Max, IsIn } from "class-validator";
import { Type } from "class-transformer";
import { VehicleType, VehicleStatus } from "@prisma/client";

export const VEHICLE_LIST_FILTER = {
  ALL: "all",
  ASSIGNED: "assigned",
  UNASSIGNED: "unassigned",
} as const;
export type VehicleListFilter =
  (typeof VEHICLE_LIST_FILTER)[keyof typeof VEHICLE_LIST_FILTER];

export const SORT_DIR = { ASC: "asc", DESC: "desc" } as const;
export type SortDir = (typeof SORT_DIR)[keyof typeof SORT_DIR];

export const VEHICLE_SORT_FIELDS = [
  "createdAt",
  "updatedAt",
  "plateNo",
  "type",
  "status",
] as const;
export type VehicleSortBy = (typeof VEHICLE_SORT_FIELDS)[number];

export class ListVehiclesQueryDto {
  @ApiPropertyOptional({ description: "Search: plateNo, type, or vehicleDescription (case-insensitive contains)" })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    enum: Object.values(VEHICLE_LIST_FILTER),
    default: VEHICLE_LIST_FILTER.ALL,
    description: "Filter by assignment: all | assigned | unassigned",
  })
  @IsOptional()
  @IsIn(Object.values(VEHICLE_LIST_FILTER))
  filter?: VehicleListFilter = VEHICLE_LIST_FILTER.ALL;

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
    enum: VEHICLE_SORT_FIELDS,
    default: "createdAt",
    description: "Sort field",
  })
  @IsOptional()
  @IsIn(VEHICLE_SORT_FIELDS)
  sortBy?: VehicleSortBy = "createdAt";

  @ApiPropertyOptional({ enum: Object.values(SORT_DIR), default: "desc" })
  @IsOptional()
  @IsIn(Object.values(SORT_DIR))
  sortDir?: SortDir = "desc";
}

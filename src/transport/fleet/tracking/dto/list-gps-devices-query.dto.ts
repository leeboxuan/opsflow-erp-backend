import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBooleanString, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export const GPS_DEVICE_SORT_FIELDS = [
  "createdAt",
  "updatedAt",
  "terminalId",
  "lastSeenAt",
] as const;

export class ListGpsDevicesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page?: number = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: "true/false" })
  @IsOptional()
  @IsBooleanString()
  isActive?: string;

  @ApiPropertyOptional({ enum: ["all", "assigned", "unassigned"], default: "all" })
  @IsOptional()
  @IsIn(["all", "assigned", "unassigned"])
  assignment?: "all" | "assigned" | "unassigned" = "all";

  @ApiPropertyOptional({ enum: GPS_DEVICE_SORT_FIELDS, default: "createdAt" })
  @IsOptional()
  @IsIn(GPS_DEVICE_SORT_FIELDS)
  sortBy?: (typeof GPS_DEVICE_SORT_FIELDS)[number] = "createdAt";

  @ApiPropertyOptional({ enum: ["asc", "desc"], default: "desc" })
  @IsOptional()
  @IsIn(["asc", "desc"])
  sortDir?: "asc" | "desc" = "desc";
}

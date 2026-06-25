import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export const CHASSIS_SORT_FIELDS = [
  "createdAt",
  "updatedAt",
  "chassisNo",
  "status",
] as const;

export class ListChassisQueryDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ enum: ["ONLINE", "STALE", "OFFLINE", "UNASSIGNED"] })
  @IsOptional()
  @IsIn(["ONLINE", "STALE", "OFFLINE", "UNASSIGNED"])
  trackingStatus?: "ONLINE" | "STALE" | "OFFLINE" | "UNASSIGNED";

  @ApiPropertyOptional({ enum: CHASSIS_SORT_FIELDS, default: "createdAt" })
  @IsOptional()
  @IsIn(CHASSIS_SORT_FIELDS)
  sortBy?: (typeof CHASSIS_SORT_FIELDS)[number] = "createdAt";

  @ApiPropertyOptional({ enum: ["asc", "desc"], default: "desc" })
  @IsOptional()
  @IsIn(["asc", "desc"])
  sortDir?: "asc" | "desc" = "desc";
}

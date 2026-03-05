import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsInt, Min, Max } from "class-validator";
import { Type } from "class-transformer";

export class JobListQueryDto {
  @ApiPropertyOptional({ description: "Search internalRef, addresses, receiver" })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: "Filter by status" })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: "Filter by customer company id" })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiPropertyOptional({ description: "Pickup date from (YYYY-MM-DD)" })
  @IsOptional()
  @IsString()
  pickupDateFrom?: string;

  @ApiPropertyOptional({ description: "Pickup date to (YYYY-MM-DD)" })
  @IsOptional()
  @IsString()
  pickupDateTo?: string;

  @ApiPropertyOptional({ description: "Max results", default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;
}

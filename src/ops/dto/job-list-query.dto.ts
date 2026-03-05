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

  @ApiPropertyOptional({ description: "Page number", default: 1, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page?: number = 1;

  @ApiPropertyOptional({ description: "Page size", default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, Min } from "class-validator";

export class ChassisHistoryQueryDto {
  @ApiProperty({ description: "Date (YYYY-MM-DD)", example: "2026-06-25" })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "date must be YYYY-MM-DD" })
  date!: string;

  @ApiPropertyOptional({ description: "Minimum stop duration in minutes", default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(60)
  stopMinutes?: number = 10;

  @ApiPropertyOptional({ description: "Stop detection radius in meters", default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(20)
  @Max(300)
  stopRadiusMeters?: number = 50;
}

import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsOptional, IsEnum, MinLength } from "class-validator";
import { VehicleType, VehicleStatus } from "@prisma/client";

export class UpdateVehicleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  plateNo?: string;

  @ApiPropertyOptional({ enum: VehicleType })
  @IsOptional()
  @IsEnum(VehicleType)
  type?: VehicleType;

  @ApiPropertyOptional({ enum: VehicleStatus })
  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vehicleDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  driverId?: string | null;
}

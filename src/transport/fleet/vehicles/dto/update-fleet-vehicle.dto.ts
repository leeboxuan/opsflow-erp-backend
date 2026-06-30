import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";
import { VehicleStatus, VehicleType } from "@prisma/client";

export class UpdateFleetVehicleDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  roadTaxExpiryDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  lastServicingDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  coeExpiryDate?: string | null;
}

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";
import { VehicleStatus, VehicleType } from "@prisma/client";

export class CreateFleetVehicleDto {
  @ApiProperty({ example: "SBA 1234 A" })
  @IsString()
  @MinLength(1)
  plateNo: string;

  @ApiProperty({ enum: VehicleType })
  @IsEnum(VehicleType)
  type: VehicleType;

  @ApiPropertyOptional({ enum: VehicleStatus, default: VehicleStatus.ACTIVE })
  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vehicleDescription?: string;

  @ApiPropertyOptional({ description: "User id of assigned driver" })
  @IsOptional()
  @IsString()
  driverId?: string;

  @ApiPropertyOptional({ example: "2026-12-31" })
  @IsOptional()
  @IsDateString()
  roadTaxExpiryDate?: string;

  @ApiPropertyOptional({ example: "2026-06-01" })
  @IsOptional()
  @IsDateString()
  lastServicingDate?: string;

  @ApiPropertyOptional({ example: "2028-04-15" })
  @IsOptional()
  @IsDateString()
  coeExpiryDate?: string;
}

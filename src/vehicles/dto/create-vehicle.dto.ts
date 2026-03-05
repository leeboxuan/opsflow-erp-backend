import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsOptional, IsEnum, MinLength } from "class-validator";
import { VehicleType, VehicleStatus } from "@prisma/client";

export class CreateVehicleDto {
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
}

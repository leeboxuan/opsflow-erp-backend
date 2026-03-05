import { ApiProperty } from "@nestjs/swagger";
import { VehicleType, VehicleStatus } from "@prisma/client";

export class VehicleDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  plateNo: string;

  @ApiProperty({ enum: VehicleType })
  type: VehicleType;

  @ApiProperty({ enum: VehicleStatus })
  status: VehicleStatus;

  @ApiProperty({ nullable: true })
  vehicleDescription: string | null;

  @ApiProperty({ nullable: true })
  driverId: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

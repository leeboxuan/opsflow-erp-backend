import { ApiProperty } from "@nestjs/swagger";
import { MembershipStatus } from "@prisma/client";

export class AdminDriverDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ nullable: true })
  name: string | null;

  @ApiProperty({ nullable: true })
  phone: string | null;

  @ApiProperty({ enum: MembershipStatus })
  status: MembershipStatus;

  @ApiProperty()
  isSuspended: boolean;

  @ApiProperty()
  membershipId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ nullable: true, required: false })
  defaultVehicleId?: string | null;

  @ApiProperty({ nullable: true, required: false })
  defaultFleetVehicleId?: string | null;

  @ApiProperty({ nullable: true, required: false })
  assignedVehicleId?: string | null;

  @ApiProperty({ nullable: true, required: false })
  assignedVehiclePlateNo?: string | null;

  @ApiProperty({ nullable: true, required: false })
  assignedVehicleType?: string | null;

  @ApiProperty({ nullable: true, required: false })
  assignedFleetVehicleId?: string | null;

  @ApiProperty({ nullable: true, required: false })
  assignedFleetVehiclePlateNo?: string | null;

  @ApiProperty({ nullable: true, required: false })
  assignedFleetVehicleType?: string | null;
}
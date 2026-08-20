import { ApiProperty } from "@nestjs/swagger";
import { MembershipStatus } from "@prisma/client";

export class AdminDriverDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  id: string;

  @ApiProperty({
    nullable: true,
    description: "Public email. Null for username-only drivers.",
  })
  email: string | null;

  @ApiProperty({
    nullable: true,
    required: false,
    description: "Login username when the driver has no email.",
  })
  username?: string | null;

  @ApiProperty({ nullable: true })
  name: string | null;

  @ApiProperty({ nullable: true, required: false })
  displayName?: string | null;

  @ApiProperty({ nullable: true, required: false })
  userName?: string | null;

  @ApiProperty({ nullable: true, required: false })
  userEmail?: string | null;

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
  avatarUrl?: string | null;

  @ApiProperty({ nullable: true, required: false })
  avatarUpdatedAt?: Date | null;

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
  assignedVehicleStatus?: string | null;

  @ApiProperty({ nullable: true, required: false })
  assignedFleetVehicleId?: string | null;

  @ApiProperty({ nullable: true, required: false })
  assignedFleetVehiclePlateNo?: string | null;

  @ApiProperty({ nullable: true, required: false })
  assignedFleetVehicleType?: string | null;

  @ApiProperty({ nullable: true, required: false })
  assignedFleetVehicleStatus?: string | null;

  @ApiProperty({
    description: "Driver is authorised to enter PSA port facilities.",
  })
  hasPsaPortAccess!: boolean;
}
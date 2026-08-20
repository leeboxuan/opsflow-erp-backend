import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString } from "class-validator";

export class AdminUpdateDriverDto {
  @ApiProperty({ example: "John Doe", required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: "+6591234567", required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    description: "Assigned vehicle id for job assignment",
    required: false,
  })
  @IsOptional()
  @IsString()
  assignedVehicleId?: string;

  @ApiProperty({
    description: "Assigned fleet vehicle id for job assignment",
    required: false,
  })
  @IsOptional()
  @IsString()
  assignedFleetVehicleId?: string;

  @ApiProperty({
    required: false,
    description:
      "Driver is authorised to enter PSA port facilities.",
  })
  @IsOptional()
  @IsBoolean()
  hasPsaPortAccess?: boolean;

  @ApiProperty({
    required: false,
    description:
      "Required when clearing PSA access while the driver still has active PSA-required trip assignments. Assignments are preserved; conflicts are reported.",
  })
  @IsOptional()
  @IsBoolean()
  confirmRemovePsaAccess?: boolean;
}
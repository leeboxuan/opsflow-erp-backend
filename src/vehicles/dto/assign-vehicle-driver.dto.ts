import { IsOptional, IsString } from "class-validator";

export class AssignVehicleDriverDto {
  // allow null to unassign
  @IsOptional()
  @IsString()
  driverId?: string | null;
}
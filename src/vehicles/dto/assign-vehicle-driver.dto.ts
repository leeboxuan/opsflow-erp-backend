import { IsOptional, IsString, ValidateIf } from "class-validator";

export class AssignVehicleDriverDto {
  @IsOptional()
  @ValidateIf((o) => o.driverId !== null)
  @IsString()
  driverId?: string | null;
}
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class AssignFleetVehicleDriverDto {
  @ApiPropertyOptional({
    description: "User id of driver. Send null/empty to unassign",
  })
  @IsOptional()
  @IsString()
  driverId?: string | null;
}

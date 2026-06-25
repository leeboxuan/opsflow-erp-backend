import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class AssignGpsDeviceChassisDto {
  @ApiProperty({ nullable: true })
  @IsOptional()
  @IsString()
  chassisId!: string | null;
}

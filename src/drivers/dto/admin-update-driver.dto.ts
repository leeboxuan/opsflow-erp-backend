import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class AdminUpdateDriverDto {
  @ApiProperty({ example: "John Doe", required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: "+6591234567", required: false })
  @IsOptional()
  @IsString()
  phone?: string;
}
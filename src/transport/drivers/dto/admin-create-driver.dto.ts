import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, MinLength } from "class-validator";

export class AdminCreateDriverDto {
  @ApiProperty({
    example: "ahmad",
    description: "Driver Mobile login username. Required. Case-insensitive; globally unique.",
  })
  @IsString()
  @MinLength(2)
  username!: string;

  @ApiProperty({ example: "John Doe", required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: "+6591234567", required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    description: "Initial password for Driver Mobile login",
    example: "StrongPass123",
  })
  @IsString()
  @MinLength(8)
  password!: string;
}

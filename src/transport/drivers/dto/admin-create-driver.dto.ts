import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from "class-validator";

export class AdminCreateDriverDto {
  @ApiPropertyOptional({
    example: "driver@example.com",
    description: "Required when username is not provided.",
  })
  @ValidateIf((o: AdminCreateDriverDto) => !o.username?.trim())
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: "ahmad",
    description:
      "Login username for drivers without email. Required when email is not provided.",
  })
  @ValidateIf((o: AdminCreateDriverDto) => !o.email?.trim())
  @IsString()
  @MinLength(2)
  username?: string;

  @ApiProperty({ example: "John Doe", required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: "+6591234567", required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    description: "Initial password for driver login",
    example: "StrongPass123",
  })
  @IsString()
  @MinLength(8)
  password!: string;
}

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";

export class PlatformBootstrapSetupDto {
  @ApiProperty({ example: "owner@opsflow.io" })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: "Password must be at least 8 characters" })
  password!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    description: "Must match PLATFORM_BOOTSTRAP_TOKEN. Never logged.",
  })
  @IsString()
  @MinLength(1)
  bootstrapToken!: string;
}

export class PlatformBootstrapStatusDto {
  @ApiProperty()
  available!: boolean;
}

export class PlatformBootstrapResultDto {
  @ApiProperty()
  ok!: boolean;

  @ApiPropertyOptional()
  platformAdmin?: { id: string; status: string };
}

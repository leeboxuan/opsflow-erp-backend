import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { PushPlatform } from "@prisma/client";

export class RegisterPushDeviceDto {
  @ApiProperty({ example: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" })
  @IsString()
  @MinLength(10)
  expoPushToken!: string;

  @ApiPropertyOptional({ enum: ["ios", "android", "unknown"] })
  @IsOptional()
  @IsIn(["ios", "android", "unknown"])
  platform?: "ios" | "android" | "unknown";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appVersion?: string;
}

export class UnregisterPushDeviceDto {
  @ApiProperty()
  @IsString()
  @MinLength(10)
  expoPushToken!: string;
}

export class PushDeviceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: PushPlatform })
  platform!: PushPlatform;

  @ApiProperty()
  expoPushToken!: string;

  @ApiPropertyOptional()
  deviceId?: string | null;

  @ApiPropertyOptional()
  appVersion?: string | null;

  @ApiProperty()
  lastSeenAt!: Date;

  @ApiPropertyOptional()
  disabledAt?: Date | null;
}

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from "class-validator";

export class DeviceGatewayLocationPayloadDto {
  @ApiProperty({ example: 1.3521 })
  @IsNumber()
  lat!: number;

  @ApiProperty({ example: 103.8198 })
  @IsNumber()
  lng!: number;

  @ApiPropertyOptional({ example: 42.5 })
  @IsOptional()
  @IsNumber()
  speedKph?: number;

  @ApiPropertyOptional({ example: 180 })
  @IsOptional()
  @IsNumber()
  heading?: number;

  @ApiPropertyOptional({ example: 12.3 })
  @IsOptional()
  @IsNumber()
  altitude?: number;

  @ApiPropertyOptional({ example: 3850 })
  @IsOptional()
  @IsNumber()
  batteryVoltageMv?: number;

  @ApiPropertyOptional({ example: 3.85 })
  @IsOptional()
  @IsNumber()
  batteryVoltage?: number;

  @ApiPropertyOptional({ example: 87 })
  @IsOptional()
  @IsNumber()
  batteryPercent?: number;

  @ApiPropertyOptional({ example: 24 })
  @IsOptional()
  @IsNumber()
  signalStrength?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsNumber()
  satelliteCount?: number;

  @ApiProperty({ example: "2026-05-21T12:34:56.000Z" })
  @IsDateString()
  recordedAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  rawMessageId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, unknown>;
}

export class DeviceGatewayEventDto {
  @ApiProperty({ enum: ["JT808"] })
  @IsIn(["JT808"])
  protocol!: "JT808";

  @ApiProperty({ enum: ["GPS_TRACKER"] })
  @IsIn(["GPS_TRACKER"])
  deviceType!: "GPS_TRACKER";

  @ApiProperty({ example: "123456789012" })
  @IsString()
  @MinLength(1)
  terminalId!: string;

  @ApiProperty({ enum: ["LOCATION"] })
  @IsIn(["LOCATION"])
  event!: "LOCATION";

  @ApiProperty({ type: DeviceGatewayLocationPayloadDto })
  @ValidateNested()
  @Type(() => DeviceGatewayLocationPayloadDto)
  payload!: DeviceGatewayLocationPayloadDto;
}

export class DeviceGatewayEventResponseDto {
  @ApiProperty()
  ok!: true;

  @ApiProperty()
  gpsDeviceId!: string;

  @ApiPropertyOptional()
  chassisId?: string | null;

  @ApiPropertyOptional()
  vehicleId?: string | null;

  @ApiPropertyOptional()
  driverId?: string | null;

  @ApiProperty()
  lat!: number;

  @ApiProperty()
  lng!: number;

  @ApiProperty()
  recordedAt!: string;
}

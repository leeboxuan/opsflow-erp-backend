import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

export class CreateGpsDeviceDto {
  @ApiProperty({ example: "001234567890" })
  @IsString()
  @MinLength(1)
  terminalId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imei?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  simNumber?: string;

  @ApiPropertyOptional({ default: "TK905B-4G" })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ default: "JT808" })
  @IsOptional()
  @IsString()
  protocol?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  chassisId?: string;
}

import { IsDateString, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateLocationDto {
  @ApiProperty({ example: 1.29027 })
  @IsNumber()
  @Type(() => Number)
  lat: number;

  @ApiProperty({ example: 103.851959 })
  @IsNumber()
  @Type(() => Number)
  lng: number;

  @ApiProperty({ example: 10.5, required: false })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  accuracy?: number;

  @ApiProperty({ example: 45.0, required: false })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  heading?: number;

  @ApiProperty({ example: 25.5, required: false })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  speed?: number;

  @ApiProperty({ example: "2026-05-05T11:20:30.000Z", required: false })
  @IsOptional()
  @IsDateString()
  recordedAt?: string;
}

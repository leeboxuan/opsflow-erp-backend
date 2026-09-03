import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsNumber, IsOptional, IsString } from "class-validator";

export class DriverTripCompleteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trailerParkingLocationCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trailerParkingAddress1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trailerParkingAddress2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trailerParkingPostal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trailerParkingPlaceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === "" || value == null ? undefined : Number(value)))
  @IsNumber()
  trailerParkingLat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === "" || value == null ? undefined : Number(value)))
  @IsNumber()
  trailerParkingLng?: number;
}

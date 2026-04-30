import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsEnum,
  Matches,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

export class DispatchReorderTripsDto {
  @ApiProperty({ example: "2026-04-30" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  tripIdsInOrder!: string[];
}

export class DispatchStartLocationDto {
  @ApiProperty()
  @IsNumber()
  lat!: number;

  @ApiProperty()
  @IsNumber()
  lng!: number;
}

export enum DispatchOptimiseStrategy {
  DISTANCE = "DISTANCE",
  TIME = "TIME",
}

export class DispatchOptimiseRouteDto {
  @ApiProperty({ example: "2026-04-30" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiProperty({ enum: DispatchOptimiseStrategy })
  @IsEnum(DispatchOptimiseStrategy)
  strategy!: DispatchOptimiseStrategy;

  @ApiPropertyOptional({ type: () => DispatchStartLocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DispatchStartLocationDto)
  startLocation?: DispatchStartLocationDto;
}

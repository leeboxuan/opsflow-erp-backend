import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { StatisticsFiltersQueryDto } from "./statistics-filters.query.dto";

export const STATISTICS_LOOKUP_ENTITIES = [
  "customers",
  "jobs",
  "trips",
  "drivers",
  "vehicles",
  "containers",
] as const;

export type StatisticsLookupEntity =
  (typeof STATISTICS_LOOKUP_ENTITIES)[number];

export class StatisticsLookupsQueryDto {
  @ApiProperty({ enum: STATISTICS_LOOKUP_ENTITIES })
  @IsIn(STATISTICS_LOOKUP_ENTITIES)
  entity!: StatisticsLookupEntity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  q?: string;
}

export class StatisticsLookupSelectedQueryDto extends StatisticsFiltersQueryDto {}

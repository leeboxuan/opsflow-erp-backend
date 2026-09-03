import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SingaporeLocationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: "Display label composed from code and name" })
  label!: string;

  @ApiPropertyOptional({ nullable: true })
  addressLine1!: string | null;

  @ApiPropertyOptional({ nullable: true })
  addressLine2!: string | null;

  @ApiPropertyOptional({ nullable: true })
  postalCode!: string | null;

  @ApiPropertyOptional({ nullable: true, default: "SG" })
  country!: string | null;

  @ApiPropertyOptional({ nullable: true })
  lat!: number | null;

  @ApiPropertyOptional({ nullable: true })
  lng!: number | null;

  @ApiPropertyOptional({ nullable: true })
  placeId!: string | null;

  /**
   * Human-readable operating hours for UI secondary text.
   * Sourced from MasterSingaporeDepot.operatingHoursSummary when present;
   * null when unspecified (UI shows a fallback). Ports / logistics locations
   * without a stored hours field remain null.
   */
  @ApiPropertyOptional({
    nullable: true,
    description:
      "Optional summary of depot operating hours (e.g. Mon–Fri 08:00–17:00). Null when unspecified.",
  })
  operatingHoursSummary!: string | null;
}

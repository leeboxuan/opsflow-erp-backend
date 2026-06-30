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
}

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from "class-validator";

export class CreateChassisDto {
  @ApiProperty({ example: "TCLU1234567" })
  @IsString()
  @MinLength(1)
  chassisNo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ default: "ACTIVE" })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isBorrowed?: boolean;

  @ApiPropertyOptional({
    description: "Required when isBorrowed is true; cleared when company-owned",
  })
  @ValidateIf((o: CreateChassisDto) => o.isBorrowed === true)
  @IsString()
  @MinLength(1)
  borrowedFromCompany?: string | null;
}

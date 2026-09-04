import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from "class-validator";

export class UpdateChassisDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  chassisNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isBorrowed?: boolean;

  @ApiPropertyOptional({
    description: "Required when isBorrowed is true; null/omitted clears when company-owned",
  })
  @ValidateIf((o: UpdateChassisDto) => o.isBorrowed === true)
  @IsOptional()
  @IsString()
  @MinLength(1)
  borrowedFromCompany?: string | null;
}

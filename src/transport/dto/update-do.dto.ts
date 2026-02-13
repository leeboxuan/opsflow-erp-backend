import { IsOptional, IsString, IsDateString, IsEnum } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { DoStatus } from "@prisma/client";

export class UpdateDoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  doDocumentUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  doSignatureUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  doSignerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  doSignedAt?: string;

  @ApiPropertyOptional({ enum: DoStatus })
  @IsOptional()
  @IsEnum(DoStatus)
  doStatus?: DoStatus;
}

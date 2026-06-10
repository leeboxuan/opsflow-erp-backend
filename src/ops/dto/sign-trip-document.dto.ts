import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsOptional, IsString } from "class-validator";

export class SignTripDocumentDto {
  @ApiPropertyOptional({ description: "Customer/shipper/receiver name captured on mobile." })
  @IsOptional()
  @IsString()
  signedByName?: string;

  @ApiPropertyOptional({
    description: "ISO timestamp from mobile when signature was captured.",
  })
  @IsOptional()
  @IsDateString()
  signedAt?: string;

  @ApiPropertyOptional({
    description: "Raw base64 signature image (optionally prefixed with data URL header).",
  })
  @IsOptional()
  @IsString()
  signatureBase64?: string;

  @ApiPropertyOptional({
    description: "Full data URL signature image, e.g. data:image/png;base64,...",
  })
  @IsOptional()
  @IsString()
  signatureImage?: string;

  @ApiPropertyOptional({ example: "image/png" })
  @IsOptional()
  @IsString()
  signatureContentType?: string;

  @ApiPropertyOptional({
    description: "Document type hint from mobile (PICKUP_DO, DELIVERY_DO, POD_SIGNATURE).",
  })
  @IsOptional()
  @IsString()
  documentType?: string;
}

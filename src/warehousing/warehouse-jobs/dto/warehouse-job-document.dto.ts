import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WarehouseJobDocumentType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UploadWarehouseJobDocumentDto {
  @ApiProperty({ enum: WarehouseJobDocumentType })
  @IsEnum(WarehouseJobDocumentType)
  type!: WarehouseJobDocumentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateWarehouseJobDocumentDto {
  @ApiPropertyOptional({ enum: WarehouseJobDocumentType })
  @IsOptional()
  @IsEnum(WarehouseJobDocumentType)
  type?: WarehouseJobDocumentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class RejectWarehouseJobDocumentDto {
  @ApiProperty()
  @IsString()
  reason!: string;
}

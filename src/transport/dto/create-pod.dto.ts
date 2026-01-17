import { IsEnum, IsOptional, IsString, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PodStatus } from '@prisma/client';

export class CreatePodDto {
  @ApiProperty({ example: PodStatus.Completed, enum: PodStatus, required: false })
  @IsOptional()
  @IsEnum(PodStatus)
  status?: PodStatus;

  @ApiProperty({ example: 'John Doe', required: false })
  @IsOptional()
  @IsString()
  signedBy?: string;

  @ApiProperty({ example: '2024-01-15T10:00:00Z', required: false })
  @IsOptional()
  @IsDateString()
  signedAt?: string;

  @ApiProperty({ example: 'https://example.com/photo.jpg', required: false })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ApiProperty({ example: 'https://example.com/signature.jpg', required: false })
  @IsOptional()
  @IsString()
  signatureUrl?: string;

  @ApiProperty({ example: 'Delivery completed successfully', required: false })
  @IsOptional()
  @IsString()
  note?: string;
}

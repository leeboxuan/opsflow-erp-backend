import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class CreateBatchDto {
  @ApiPropertyOptional({ description: 'If omitted, auto-generated as B260205-001 style' })
  @IsOptional()
  @IsString()
  containerNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

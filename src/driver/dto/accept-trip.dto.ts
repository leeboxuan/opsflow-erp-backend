import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AcceptTripDto {
  @ApiProperty({ example: 'ABC-1234', required: false })
  @IsOptional()
  @IsString()
  vehicleNo?: string;

  @ApiProperty({ example: 'TRL-001', required: false })
  @IsOptional()
  @IsString()
  trailerNo?: string;
}

import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignVehicleDto {
  @ApiProperty({ example: 'clx1234567890abcdef', required: false })
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @ApiProperty({ example: 'SBA 1234 A', required: false })
  @IsOptional()
  @IsString()
  plateNo?: string;
}

import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateVehicleDto {
  @ApiProperty({ example: 'ABC-1234' })
  @IsString()
  vehicleNumber: string;

  @ApiProperty({ example: 'Van', required: false })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({ example: 'Description of the vehicle', required: false })
  @IsOptional()
  @IsString()
  vehicleDescription?: string;
}

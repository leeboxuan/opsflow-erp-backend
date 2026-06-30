import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignDriverDto {
  @ApiProperty({ example: 'clx1234567890abcdef' })
  @IsString()
  driverUserId: string;
}

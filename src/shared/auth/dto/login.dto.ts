import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class LoginDto {
  @ApiPropertyOptional({
    example: 'user@example.com',
    description: 'Email login (web / transport staff). Mutually exclusive with username.',
  })
  @ValidateIf((o: LoginDto) => !o.username)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'floor1',
    description:
      'Username login. Driver Mobile requires this field (not email). Warehouse mobile may also use username. Mutually exclusive with email for staff/web.',
  })
  @ValidateIf((o: LoginDto) => !o.email)
  @IsString()
  @MinLength(1)
  username?: string;

  @ApiPropertyOptional({
    example: 'acme',
    description:
      'Optional tenant slug membership filter. Usernames are globally unique after canonical normalize; slug is not a uniqueness domain.',
  })
  @IsOptional()
  @IsString()
  tenantSlug?: string;

  @ApiPropertyOptional({
    example: 'web',
    description:
      "Optional client hint: 'web' | 'staff' | 'mobile' | 'driver_mobile' | 'warehouse_mobile'. Driver Mobile requires TRANSPORT_DRIVER. Staff web rejects TRANSPORT_DRIVER-only accounts.",
  })
  @IsOptional()
  @IsString()
  clientApp?: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(1)
  password!: string;
}

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
    description: 'Username login (warehouse mobile). Mutually exclusive with email.',
  })
  @ValidateIf((o: LoginDto) => !o.email)
  @IsString()
  @MinLength(1)
  username?: string;

  @ApiPropertyOptional({
    example: 'acme',
    description:
      'Tenant slug when logging in with username (required if the username exists in multiple tenants).',
  })
  @IsOptional()
  @IsString()
  tenantSlug?: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(1)
  password!: string;
}

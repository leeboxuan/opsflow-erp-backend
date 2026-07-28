import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { MembershipStatus, Role } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(2)
  username?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}

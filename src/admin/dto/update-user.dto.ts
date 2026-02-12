import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MembershipStatus, Role } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}

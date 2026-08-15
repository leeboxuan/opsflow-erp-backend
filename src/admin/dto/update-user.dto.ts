import { IsArray, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { MembershipStatus } from '@prisma/client';

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

  /** @deprecated Prefer PUT /admin/users/:userId/roles. */
  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];

  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}

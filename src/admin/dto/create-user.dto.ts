import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CanonicalTenantRole } from '@prisma/client';

export class CreateUserDto {
  @ValidateIf((o: CreateUserDto) => !o.username)
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  username?: string;

  @IsString()
  @MinLength(1, { message: 'name is required' })
  name!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  /** @deprecated Prefer `roles`. Singular compatibility input. */
  @ValidateIf((o: CreateUserDto) => !o.roles?.length)
  @IsString()
  role?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];

  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean = true;

  /** Required when creating username-based users (warehouse mobile) without invite. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsString()
  customerCompanyId?: string;

  @IsOptional()
  @IsString()
  customerCompanyName?: string;

  @IsOptional()
  @IsString()
  customerContactName?: string;

  @IsOptional()
  @IsString()
  customerContactEmail?: string;
}

export { CanonicalTenantRole };

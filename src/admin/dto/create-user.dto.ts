import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Role } from '@prisma/client';

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

  @IsEnum(Role)
  role!: Role; // ADMIN | TRANSPORT_STAFF | OPS (deprecated) | FINANCE | WAREHOUSE | CUSTOMER (NOT Driver)

  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean = true;

  /** Required when creating username-based users (warehouse mobile) without invite. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  // 👇 Only required when role === CUSTOMER
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

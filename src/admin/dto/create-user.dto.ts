import { IsEmail, IsEnum, IsOptional, IsString, IsBoolean } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsEnum(Role)
  role!: Role; // Admin | Ops | Finance (NOT Driver)

  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean = true; // default true
}

import { IsEmail, IsEnum, IsOptional, IsString, IsBoolean } from "class-validator";
import { Role } from "@prisma/client";

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsEnum(Role)
  role!: Role; // ADMIN | OPS | FINANCE | CUSTOMER (NOT Driver)

  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean = true;

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

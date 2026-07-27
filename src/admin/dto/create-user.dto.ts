import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsBoolean,
  MinLength,
} from "class-validator";
import { Role } from "@prisma/client";

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1, { message: "name is required" })
  name!: string;

  @IsEnum(Role)
  role!: Role; // ADMIN | TRANSPORT_STAFF | OPS (deprecated) | FINANCE | WAREHOUSE | CUSTOMER (NOT Driver)

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

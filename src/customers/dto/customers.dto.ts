import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  IsEmail,
  IsBoolean,
} from "class-validator";
import { Type } from "class-transformer";

export class ListCompaniesQueryDto {
  @ApiPropertyOptional({ description: "Search by company name" })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: "Max results (default 20, max 100)",
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class ListContactsQueryDto {
  @ApiPropertyOptional({ description: "Search by contact name/email" })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: "Max results (default 20, max 100)",
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class CustomerCompanyDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  email?: string | null;

  @ApiPropertyOptional()
  phone?: string | null;

  @ApiPropertyOptional()
  addressLine1?: string | null;

  @ApiPropertyOptional()
  addressLine2?: string | null;

  @ApiPropertyOptional()
  postalCode?: string | null;

  @ApiPropertyOptional()
  country?: string | null;

  @ApiPropertyOptional()
  billingSameAsAddress?: boolean;

  @ApiPropertyOptional()
  billingAddressLine1?: string | null;

  @ApiPropertyOptional()
  billingAddressLine2?: string | null;

  @ApiPropertyOptional()
  billingPostalCode?: string | null;

  @ApiPropertyOptional()
  billingCountry?: string | null;

  @ApiPropertyOptional()
  picName?: string | null;

  @ApiPropertyOptional()
  picMobile?: string | null;

  @ApiPropertyOptional()
  picEmail?: string | null;

  @ApiPropertyOptional()
  uen?: string | null;

  @ApiPropertyOptional()
  notes?: string | null;

  @ApiPropertyOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: "Number of contacts under this company" })
  contactCount?: number;

  @ApiPropertyOptional({ description: "Number of portal users linked to this company" })
  userCount?: number;
}

export class CustomerContactDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional()
  mobile?: string | null;
}

export class CreateCustomerCompanyDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  postalCode?: string;

  @ApiPropertyOptional({ default: "SG" })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  billingSameAsAddress?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingAddressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingAddressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingPostalCode?: string;

  @ApiPropertyOptional({ default: "SG" })
  @IsOptional()
  @IsString()
  billingCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  picName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  picMobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  picEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  uen?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCustomerCompanyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  postalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  billingSameAsAddress?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingAddressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingAddressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingPostalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  picName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  picMobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  picEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  uen?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

export class CreateCustomerContactDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mobile?: string;
}

export class CustomerCompanyUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional()
  name?: string | null;

  @ApiPropertyOptional({ description: "Tenant membership status (Active/Invited/Suspended)" })
  status?: string | null;
}

export class CreateCustomerCompanyUserDto {
  @ApiProperty({ description: "User email" })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ description: "User display name" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: "Send Supabase invite email (default true)",
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  sendInvite?: boolean;
}
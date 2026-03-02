import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  IsEmail,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ListCompaniesQueryDto {
  @ApiPropertyOptional({ description: 'Search by company name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Max results (default 20, max 100)',
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class ListContactsQueryDto {
  @ApiPropertyOptional({ description: 'Search by contact name/email' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Max results (default 20, max 100)',
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

  @ApiPropertyOptional({ description: 'Number of contacts under this company' })
  contactCount?: number;

  @ApiPropertyOptional({ description: 'Number of portal users linked to this company' })
  userCount?: number;
}

export class CustomerContactDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;
}

export class CreateCustomerCompanyDto {
  @ApiProperty({ description: 'Customer company name' })
  @IsString()
  name: string;
}

export class CreateCustomerContactDto {
  @ApiProperty({ description: 'Contact name' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Contact email' })
  @IsEmail()
  email: string;
}

export class CustomerCompanyUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional()
  name?: string | null;

  @ApiPropertyOptional({ description: 'Tenant membership status (Active/Invited/Suspended)' })
  status?: string | null;
}

export class CreateCustomerCompanyUserDto {
  @ApiProperty({ description: 'User email' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ description: 'User display name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Send Supabase invite email (default true)',
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  sendInvite?: boolean;
}
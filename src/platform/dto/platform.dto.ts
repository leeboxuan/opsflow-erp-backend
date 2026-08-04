import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  MembershipStatus,
  Role,
  TenantModule,
  TenantStatus,
} from "@prisma/client";

export class CreatePlatformTenantDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: "URL-safe slug; immutable once tenant users exist" })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "slug must be lowercase alphanumeric with optional hyphens",
  })
  slug!: string;

  @ApiPropertyOptional({ enum: TenantStatus, default: TenantStatus.SETUP })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({
    enum: TenantModule,
    isArray: true,
    description: "Initial module entitlements (enabled)",
  })
  @IsOptional()
  @IsArray()
  @IsEnum(TenantModule, { each: true })
  modules?: TenantModule[];
}

export class UpdatePlatformTenantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    description: "Rejected if any TenantMembership exists for this tenant",
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug?: string;

  @ApiPropertyOptional({ enum: TenantStatus })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezone?: string;
}

export class SuspendTenantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SetTenantModulesDto {
  @ApiProperty({
    type: "array",
    items: {
      type: "object",
      properties: {
        module: { enum: Object.values(TenantModule) },
        enabled: { type: "boolean" },
      },
    },
  })
  @IsArray()
  modules!: Array<{ module: TenantModule; enabled: boolean }>;
}

export class CreatePlatformAdminDto {
  @ApiProperty({ description: "Existing user id to promote" })
  @IsString()
  @MinLength(1)
  userId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdatePlatformAdminDto {
  @ApiPropertyOptional({ enum: ["ACTIVE", "DISABLED"] })
  @IsOptional()
  @IsString()
  status?: "ACTIVE" | "DISABLED";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class PlatformAuditQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  targetTenantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pageSize?: string;
}

/** Validate SetTenantModulesDto.modules entries (class-validator nested). */
export class TenantModuleEntryDto {
  @IsEnum(TenantModule)
  module!: TenantModule;

  @IsBoolean()
  enabled!: boolean;
}

/** Platform Admin creates tenant colleagues with an initial password (no invite). */
export class CreatePlatformTenantUserDto {
  @ValidateIf((o: CreatePlatformTenantUserDto) => !o.username)
  @IsString()
  @MinLength(3)
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  username?: string;

  @IsString()
  @MinLength(1, { message: "name is required" })
  name!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsEnum(Role, {
    message:
      "role must be ADMIN, TRANSPORT_STAFF, FINANCE, WAREHOUSE, or CUSTOMER",
  })
  role!: Role;

  /** Required. Never logged, audited, or returned. */
  @IsString()
  @MinLength(8, { message: "Password must be at least 8 characters" })
  password!: string;

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

export class UpdatePlatformTenantUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsEnum(Role, {
    message:
      "role must be ADMIN, TRANSPORT_STAFF, FINANCE, WAREHOUSE, or CUSTOMER",
  })
  role?: Role;

  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}

export class ResetPlatformTenantUserPasswordDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: "Password must be at least 8 characters" })
  password!: string;
}

export class PlatformTenantUsersQueryDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  filter?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  roles?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortDir?: "asc" | "desc";
}

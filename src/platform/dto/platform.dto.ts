import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { TenantModule, TenantStatus } from "@prisma/client";

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

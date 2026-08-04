import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class LoginResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ description: 'Supabase session refresh token' })
  refreshToken: string;

  @ApiProperty({ description: 'Session expiry (Unix timestamp in seconds)' })
  expiresAt: number;

  @ApiProperty()
  user: {
    id: string;
    email: string | null;
    username?: string | null;
    role: Role | null;
    tenantId?: string;
  };

  @ApiProperty({ nullable: true, required: false })
  activeTenantId?: string | null;

  @ApiProperty({ required: false, type: [Object] })
  tenantMemberships?: Array<{
    tenantId: string;
    role: Role;
    status: string;
    tenant: {
      id: string;
      name: string;
    };
  }>;

  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Present when user has an ACTIVE PlatformAdmin row',
  })
  platformAdmin?: { id: string; status: string } | null;
}

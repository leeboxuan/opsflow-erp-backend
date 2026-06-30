import { ApiProperty } from '@nestjs/swagger';

export class RefreshResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ description: 'Supabase session refresh token (may be rotated)' })
  refreshToken: string;

  @ApiProperty({ description: 'Session expiry (Unix timestamp in seconds)' })
  expiresAt: number;
}

import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class LoginResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  user: {
    id: string;
    email: string;
    role: Role;
    tenantId?: string;
  };
}

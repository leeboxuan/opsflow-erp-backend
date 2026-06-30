import { IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Role, MembershipStatus } from '@prisma/client';

export class UpdateMembershipDto {
  @ApiProperty({ example: Role.OPS, enum: Role, required: false })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiProperty({
    example: MembershipStatus.Active,
    enum: MembershipStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}

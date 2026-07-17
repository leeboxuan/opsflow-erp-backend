import { ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ListQueryBaseDto } from "../../shared/common/dto";

export class AdminListQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional({ description: 'Filter by a single tenant membership role' })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({
    description: 'Comma-separated tenant membership roles, e.g. OPS,WAREHOUSE',
  })
  @IsOptional()
  @IsString()
  roles?: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ListQueryBaseDto } from "../../shared/common/dto";

export class AdminListQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional({ description: 'Filter by a single tenant membership role (legacy or canonical)' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated tenant membership roles, e.g. TENANT_ADMIN,TRANSPORT_ADMIN',
  })
  @IsOptional()
  @IsString()
  roles?: string;
}

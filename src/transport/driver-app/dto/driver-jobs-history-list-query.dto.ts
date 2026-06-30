import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { ListQueryBaseDto } from "../../../shared/common/dto";

export class DriverJobsHistoryListQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional({
    description:
      "Calendar year (YYYY) in tenant timezone; default is current calendar year in that zone. Filters by trip completion (closedAt ?? updatedAt).",
  })
  @IsOptional()
  @IsString()
  year?: string;

  @ApiPropertyOptional({
    description:
      "Calendar month (YYYY-MM) in tenant timezone; takes precedence over year. Filters by trip completion (closedAt ?? updatedAt).",
  })
  @IsOptional()
  @IsString()
  month?: string;
}


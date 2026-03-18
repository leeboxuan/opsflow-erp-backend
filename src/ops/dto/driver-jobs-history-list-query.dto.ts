import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { ListQueryBaseDto } from "../../common/dto";

export class DriverJobsHistoryListQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional({ description: "Year (YYYY) - default current year" })
  @IsOptional()
  @IsString()
  year?: string;

  @ApiPropertyOptional({ description: "Month (YYYY-MM) - takes precedence over year" })
  @IsOptional()
  @IsString()
  month?: string;
}


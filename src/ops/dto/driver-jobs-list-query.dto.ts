import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { ListQueryBaseDto } from "../../common/dto";

export class DriverJobsListQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional({ description: "Month (YYYY-MM), if provided overrides date" })
  @IsOptional()
  @IsString()
  month?: string;

  @ApiPropertyOptional({ description: "Date (YYYY-MM-DD), if provided (and no month) filters by pickupDate day" })
  @IsOptional()
  @IsString()
  date?: string;
}

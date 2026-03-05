import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { ListQueryBaseDto } from "../../common/dto";

export class DriverJobsListQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional({ description: "Date (YYYY-MM-DD), default today" })
  @IsOptional()
  @IsString()
  date?: string;
}

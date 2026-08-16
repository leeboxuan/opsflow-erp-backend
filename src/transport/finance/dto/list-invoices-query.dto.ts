import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { ListQueryBaseDto } from "../../../shared/common/dto";

export class ListInvoicesQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional({ description: "Canonical invoice status filter" })
  @IsOptional()
  @IsString()
  status?: string;
}

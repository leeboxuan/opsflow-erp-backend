import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { ListQueryBaseDto } from "../../common/dto";

export class JobListQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional({
    description: "Search internalRef, externalRef, addresses, receiver, phone",
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: "Filter by status" })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: "Filter by customer company id" })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiPropertyOptional({ description: "Pickup date from (YYYY-MM-DD)" })
  @IsOptional()
  @IsString()
  pickupDateFrom?: string;

  @ApiPropertyOptional({ description: "Pickup date to (YYYY-MM-DD)" })
  @IsOptional()
  @IsString()
  pickupDateTo?: string;
}

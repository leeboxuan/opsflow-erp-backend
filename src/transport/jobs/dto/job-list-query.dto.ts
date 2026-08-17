import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";
import { ListQueryBaseDto } from "../../../shared/common/dto";
import {
  JOB_LIST_INVOICE_STATUS_VALUES,
  JOB_LIST_TRIP_PROGRESS_VALUES,
} from "../job-list-progress";

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

  @ApiPropertyOptional({
    enum: JOB_LIST_TRIP_PROGRESS_VALUES,
    description:
      "Trip progress: incomplete, complete, none (no operational trips), cancelled (job-level)",
  })
  @IsOptional()
  @IsIn([...JOB_LIST_TRIP_PROGRESS_VALUES])
  tripProgress?: (typeof JOB_LIST_TRIP_PROGRESS_VALUES)[number];

  @ApiPropertyOptional({
    enum: JOB_LIST_INVOICE_STATUS_VALUES,
    description:
      "Invoice column filter: not_available, waiting, or a canonical InvoiceStatus",
  })
  @IsOptional()
  @IsIn([...JOB_LIST_INVOICE_STATUS_VALUES])
  invoiceStatus?: (typeof JOB_LIST_INVOICE_STATUS_VALUES)[number];

  @ApiPropertyOptional({ description: "Pickup date from (YYYY-MM-DD)" })
  @IsOptional()
  @IsString()
  pickupDateFrom?: string;

  @ApiPropertyOptional({ description: "Pickup date to (YYYY-MM-DD)" })
  @IsOptional()
  @IsString()
  pickupDateTo?: string;

  @ApiPropertyOptional({
    description:
      "Filter jobs whose pickupDate OR any trip plannedStartAt falls on this day (YYYY-MM-DD)",
  })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ description: "Same as pickup range but also matches trip planned dates" })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateTo?: string;
}

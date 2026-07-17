import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

export class DriverOperationalContainerDto {
  @ApiPropertyOptional({
    description: "JobItem id for the container row to update",
  })
  @IsString()
  itemId!: string;

  @ApiPropertyOptional({
    description: "Container number (stored as JobItem.itemCode)",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  containerNumber?: string | null;

  @ApiPropertyOptional({
    description: "Seal number (API alias; persisted as JobItem.sealNo)",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  sealNumber?: string | null;

  @ApiPropertyOptional({
    description: "Legacy alias for sealNumber",
    nullable: true,
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  sealNo?: string | null;
}

export class UpdateDriverOperationalDetailsDto {
  @ApiPropertyOptional({
    type: [DriverOperationalContainerDto],
    description:
      "Container rows to update by itemId. Drivers may only update items belonging to this job.",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DriverOperationalContainerDto)
  containers?: DriverOperationalContainerDto[];

  @ApiPropertyOptional({
    description:
      "Driver-owned remarks for this trip (does not overwrite Job.description / Job.notes)",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  driverRemarks?: string | null;
}

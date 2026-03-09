import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, IsDateString, MinLength, IsArray, ValidateNested } from "class-validator";
import { JobType } from "@prisma/client";
import { Type } from "class-transformer";


export class CreateJobItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  itemCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateJobDto {
  @ApiProperty({ enum: JobType })
  @IsEnum(JobType)
  jobType: JobType;

  @ApiProperty()
  @IsString()
  customerCompanyId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  pickupDate?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  pickupAddress1: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupAddress2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupPostal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupContactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pickupContactPhone?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  deliveryAddress1: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryAddress2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryPostal?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  receiverName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  receiverPhone: string;

  @ApiPropertyOptional({ type: [CreateJobItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJobItemDto)
  items?: CreateJobItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  notes?: string;
}



import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WarehouseJobPriority, WarehouseJobType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CreateWarehouseJobCargoLineDto } from './create-warehouse-job-cargo-line.dto';
import { CreateWarehouseJobContainerDto } from './create-warehouse-job-container.dto';
import { CreateWarehouseJobLineDto } from './create-warehouse-job-line.dto';

export class CreateWarehouseJobDto {
  @ApiProperty({ enum: WarehouseJobType })
  @IsEnum(WarehouseJobType)
  type!: WarehouseJobType;

  @ApiPropertyOptional({ enum: WarehouseJobPriority })
  @IsOptional()
  @IsEnum(WarehouseJobPriority)
  priority?: WarehouseJobPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  containerNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sealNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerCompanyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inventoryBatchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedToUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalRefType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalRefId?: string;

  @ApiPropertyOptional({
    description: 'Customer PO / order reference, e.g. 394-RW265015',
  })
  @IsOptional()
  @IsString()
  orderReference?: string;

  @ApiPropertyOptional({
    description:
      'Customer initial for generated customerReference (e.g. KAT). Required when generateCustomerReference is true.',
  })
  @IsOptional()
  @IsString()
  customerInitial?: string;

  @ApiPropertyOptional({
    description:
      'When true, allocate customerReference as DB-<creatorInitial> <YY><customerInitial>#<seq>',
  })
  @IsOptional()
  @IsBoolean()
  generateCustomerReference?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receivingVessel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  placeOfDelivery?: string;

  @ApiPropertyOptional({ default: 'Singapore' })
  @IsOptional()
  @IsString()
  destinationCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  arrivalDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  departureDate?: string;

  @ApiPropertyOptional({
    description: 'When true, generate a delivery order document after create',
  })
  @IsOptional()
  @IsBoolean()
  generateDeliveryOrder?: boolean;

  @ApiPropertyOptional({ type: [CreateWarehouseJobCargoLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWarehouseJobCargoLineDto)
  cargoLines?: CreateWarehouseJobCargoLineDto[];

  @ApiPropertyOptional({ type: [CreateWarehouseJobContainerDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWarehouseJobContainerDto)
  containers?: CreateWarehouseJobContainerDto[];

  @ApiPropertyOptional({ type: [CreateWarehouseJobLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWarehouseJobLineDto)
  lines?: CreateWarehouseJobLineDto[];
}

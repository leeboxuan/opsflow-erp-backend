import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StockInCustomerCompanyDto {
  @ApiProperty({
    description:
      'Customer company name (deduped per tenant, case-insensitive, trimmed)',
  })
  @IsString()
  name: string;
}

export class StockInContactDto {
  @ApiProperty({ description: 'In-charge person name' })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'In-charge person email (deduped per company)',
  })
  @IsEmail()
  email: string;
}

export class StockInBatchDto {
  @ApiProperty({ description: 'Batch code (unique per tenant)' })
  @IsString()
  batchCode: string;

  @ApiProperty({ description: 'Batch description' })
  @IsString()
  batchDescription: string;

  @ApiProperty({
    description: 'Received date (YYYY-MM-DD)',
    example: '2026-02-09',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  receivedDate: string;

  @ApiPropertyOptional({ description: 'Notes (optional)' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class StockInItemDto {
  @ApiProperty({ description: 'Item code / itemSku from client sheet' })
  @IsString()
  itemSku: string;

  @ApiPropertyOptional({
    description: 'Optional item name from client sheet',
  })
  @IsOptional()
  @IsString()
  itemName?: string;

  @ApiPropertyOptional({
    description: 'Optional item description from client sheet',
  })
  @IsOptional()
  @IsString()
  itemDescription?: string;

  @ApiPropertyOptional({
    description: 'Quantity (defaults to 1 if missing)',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class StockInDto {
  @ApiProperty({ type: StockInCustomerCompanyDto })
  @ValidateNested()
  @Type(() => StockInCustomerCompanyDto)
  customerCompany: StockInCustomerCompanyDto;

  @ApiProperty({ type: StockInContactDto })
  @ValidateNested()
  @Type(() => StockInContactDto)
  contact: StockInContactDto;

  @ApiProperty({ type: StockInBatchDto })
  @ValidateNested()
  @Type(() => StockInBatchDto)
  batch: StockInBatchDto;

  @ApiProperty({ type: [StockInItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockInItemDto)
  items: StockInItemDto[];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInvoiceLineItemDto {
  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  qty: number;

  @ApiProperty({ description: 'Unit price in cents', example: 38000 })
  @IsInt()
  @Min(0)
  unitPriceCents: number;

  @ApiProperty({ description: 'SR or ZR', example: 'SR' })
  @IsString()
  taxCode: string; // "SR" | "ZR"

  @ApiProperty({
    description: 'Tax rate in basis points. 900 = 9.00%, 0 = 0%',
    example: 900,
  })
  @IsInt()
  @Min(0)
  taxRate: number; // 900 = 9%
}

export class CreateInvoiceDto {
  @ApiProperty()
  @IsString()
  customerName: string;

  @ApiPropertyOptional({ example: 'SGD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: '2026-02-18' })
  @IsOptional()
  @IsString()
  issueDateISO?: string;

  @ApiPropertyOptional({ example: '2026-03-20' })
  @IsOptional()
  @IsString()
  dueDateISO?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    description: 'Orders to tag to this invoice',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  orderIds: string[];

  @ApiProperty({ type: [CreateInvoiceLineItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceLineItemDto)
  lineItems: CreateInvoiceLineItemDto[];
}

export class InvoiceLineItemDto {
  @ApiProperty() id: string;
  @ApiProperty() description: string;
  @ApiProperty() qty: number;
  @ApiProperty() unitPriceCents: number;
  @ApiProperty() amountCents: number;
  @ApiProperty() taxCode: string;
  @ApiProperty() taxRate: number;
  @ApiProperty() taxCents: number;
}

export class InvoiceDto {
  @ApiProperty() id: string;
  @ApiProperty() invoiceNo: string;
  @ApiProperty() customerName: string;
  @ApiProperty() currency: string;
  @ApiProperty() status: string;

  @ApiProperty() issueDate: Date;
  @ApiPropertyOptional() dueDate?: Date | null;

  @ApiPropertyOptional() notes?: string | null;

  @ApiProperty() subtotalCents: number;
  @ApiProperty() taxCents: number;
  @ApiProperty() totalCents: number;

  @ApiProperty({ type: [InvoiceLineItemDto] })
  lineItems: InvoiceLineItemDto[];

  @ApiProperty({ type: [String] })
  orderIds: string[];

  // --- tracking / side panel fields ---
  @ApiPropertyOptional() confirmedAt?: Date | null;
  @ApiPropertyOptional() confirmedByUserId?: string | null;
  @ApiPropertyOptional() confirmedByName?: string | null;

  @ApiPropertyOptional() markedAsSentAt?: Date | null;
  @ApiPropertyOptional() markedAsSentByUserId?: string | null;
  @ApiPropertyOptional() markedAsSentByName?: string | null;

  @ApiPropertyOptional() pdfKey?: string | null;
  @ApiPropertyOptional() pdfGeneratedAt?: Date | null;
}


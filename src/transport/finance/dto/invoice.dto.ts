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

  @ApiPropertyOptional({ description: 'Unit price in cents', example: 38000, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  unitPriceCents?: number | null;

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

  @ApiPropertyOptional({ example: "QUOTATION_MASTER" })
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceMasterItemId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  jobChargeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceJobId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceTripId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tripDisplayRef?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fromLabel?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  toLabel?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  requiresManualAmount?: boolean;
}

export class CreateInvoiceDto {
  @ApiProperty()
  @IsString()
  customerName: string;

  @ApiPropertyOptional({ example: "WISDOM_FORCE" })
  @IsOptional()
  @IsString()
  templateCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerCompanyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceJobId?: string;

  @ApiPropertyOptional({
    description: "Accepted CustomerQuotation id governing this invoice",
  })
  @IsOptional()
  @IsString()
  sourceCustomerQuotationId?: string | null;

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

  @ApiPropertyOptional({
    description:
      'Optional transport order ids to associate with this draft. Omit entirely if the invoice has no jobs/orders. When updating a draft, omit to keep existing snapshot orderIds; send [] to clear.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  orderIds?: string[];

  @ApiPropertyOptional({
    description:
      "Optional job ids whose frozen JobCharge rows are the billing source for this draft (snapshot only at issue time).",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceJobIds?: string[];

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
  @ApiPropertyOptional() sourceType?: string | null;
  @ApiPropertyOptional() jobChargeId?: string | null;
  @ApiPropertyOptional() sourceJobId?: string | null;
  @ApiPropertyOptional() sourceMasterItemId?: string | null;
  @ApiPropertyOptional() sourceTripId?: string | null;
  @ApiPropertyOptional() tripDisplayRef?: string | null;
  @ApiPropertyOptional() requiresManualAmount?: boolean;
}

export class InvoiceDto {
  @ApiProperty() id: string;
  @ApiProperty() invoiceNo: string;
  @ApiProperty() customerName: string;
  @ApiPropertyOptional() customerCompanyId?: string | null;
  @ApiPropertyOptional() sourceJobId?: string | null;
  @ApiPropertyOptional() sourceCustomerQuotationId?: string | null;
  @ApiPropertyOptional() paidAt?: Date | null;
  @ApiPropertyOptional() paidByUserId?: string | null;
  @ApiPropertyOptional() templateCode?: string;
  @ApiProperty() currency: string;
  @ApiProperty({ enum: ["DRAFT", "GENERATED", "ISSUED", "PAID", "VOID"] })
  status: string;

  @ApiProperty() issueDate: Date;
  @ApiPropertyOptional() dueDate?: Date | null;

  @ApiPropertyOptional() notes?: string | null;

  @ApiProperty() subtotalCents: number;
  @ApiProperty() taxCents: number;
  @ApiProperty() totalCents: number;

  @ApiProperty({ type: [InvoiceLineItemDto] })
  lineItems: InvoiceLineItemDto[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Associated transport order ids from snapshot or linked orders; empty array when none.',
  })
  orderIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: "Job ids stored on draft snapshot when invoice is built from JobCharge rows.",
  })
  sourceJobIds?: string[];

  // --- tracking / side panel fields ---
  @ApiPropertyOptional() confirmedAt?: Date | null;
  @ApiPropertyOptional() confirmedByUserId?: string | null;
  @ApiPropertyOptional() confirmedByName?: string | null;

  @ApiPropertyOptional() issuedAt?: Date | null;
  @ApiPropertyOptional() issuedByUserId?: string | null;
  @ApiPropertyOptional() issuedByName?: string | null;

  @ApiPropertyOptional() markedAsSentAt?: Date | null;
  @ApiPropertyOptional() markedAsSentByUserId?: string | null;
  @ApiPropertyOptional() markedAsSentByName?: string | null;

  @ApiPropertyOptional() pdfKey?: string | null;
  @ApiPropertyOptional() pdfGeneratedAt?: Date | null;
}

export class InvoicePrefillResponseDto {
  @ApiProperty() jobId: string;
  @ApiProperty() internalJobReference: string;
  @ApiProperty() customerCompanyId: string;
  @ApiProperty() customerCompanyName: string;
  @ApiProperty() invoiceTemplate: string;
  @ApiProperty() invoiceDate: string;
  @ApiProperty() dueDate: string;
  @ApiProperty() reference: string;
  @ApiProperty() currency: string;
  @ApiProperty() taxRate: number;
  @ApiProperty({ type: [CreateInvoiceLineItemDto] }) lineItems: CreateInvoiceLineItemDto[];
  @ApiProperty() subtotalCents: number;
  @ApiProperty() taxCents: number;
  @ApiProperty() totalCents: number;
  @ApiProperty() amountDueCents: number;
  @ApiPropertyOptional() existingDraftInvoiceId?: string | null;
  @ApiPropertyOptional({ type: [Object] }) billableTrips?: Array<{
    tripId: string;
    tripDisplayRef: string;
    fromLabel: string;
    toLabel: string;
  }>;
  @ApiPropertyOptional({ type: Object }) job?: {
    id: string;
    internalJobReference: string;
    customerReference: string | null;
    jobType: string;
    billableTripCount: number;
  };
  @ApiPropertyOptional() sourceCustomerQuotationId?: string | null;
  @ApiPropertyOptional({ type: [Object] }) quotationOptions?: Array<{
    id: string;
    code: string;
    label: string;
    description: string | null;
    unit: string | null;
    rateCents: number | null;
    unitPriceCents: number | null;
    requiresManualAmount: boolean;
    taxRate: number;
    rawRateText?: string | null;
    sourceMasterFileId?: string | null;
  }>;
}

export class InvoiceableJobDto {
  @ApiProperty() id: string;
  @ApiProperty() internalJobReference: string;
  @ApiPropertyOptional() customerReference?: string | null;
  @ApiProperty() jobType: string;
  @ApiProperty() status: string;
  @ApiPropertyOptional() invoiceReadyAt?: Date | null;
  @ApiProperty() tripCount: number;
  @ApiProperty() completedTripCount: number;
  @ApiProperty() billableTripCount: number;
  @ApiPropertyOptional() existingInvoiceId?: string | null;
  @ApiPropertyOptional() existingInvoiceStatus?: string | null;
  @ApiProperty() label: string;
}


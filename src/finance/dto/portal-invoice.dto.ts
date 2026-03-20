import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class PortalInvoiceCustomerCompanyDto {
  @ApiProperty()
  name: string;
}

export class PortalInvoiceDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  invoiceNumber: string;

  @ApiProperty()
  invoiceDate: Date;

  @ApiPropertyOptional({ nullable: true })
  dueDate?: Date | null;

  @ApiProperty()
  status: string;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  subtotalCents: number;

  @ApiProperty()
  taxCents: number;

  @ApiProperty()
  totalCents: number;

  @ApiProperty()
  customerCompany: PortalInvoiceCustomerCompanyDto;

  @ApiProperty()
  hasPdf: boolean;

  @ApiProperty()
  createdAt: Date;
}


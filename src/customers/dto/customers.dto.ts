import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsEmail,
  IsBoolean,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ListQueryBaseDto } from "../../shared/common/dto";
import { RateTemplateRowInputDto } from "../rate-templates/rate-templates.dto";

export class ListCompaniesQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional({ description: "Search by company name" })
  @IsOptional()
  @IsString()
  search?: string;
}

export class ListContactsQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional({ description: "Search by contact name/email" })
  @IsOptional()
  @IsString()
  search?: string;
}

const CUSTOMER_COMPANY_DOCUMENT_SORT_FIELDS = [
  "uploadedAt",
  "createdAt",
  "fileName",
] as const;

export class ListCustomerCompanyDocumentsQueryDto extends ListQueryBaseDto {
  @ApiPropertyOptional({
    description: "Sort field",
    enum: CUSTOMER_COMPANY_DOCUMENT_SORT_FIELDS,
  })
  @IsOptional()
  @IsIn(CUSTOMER_COMPANY_DOCUMENT_SORT_FIELDS)
  sortBy?: (typeof CUSTOMER_COMPANY_DOCUMENT_SORT_FIELDS)[number];
}

export class CustomerCompanyDocumentDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  customerCompanyId: string;

  @ApiProperty({ enum: ["CUSTOMER_DOCUMENT", "INVOICE", "COMPANY_INVOICE"] })
  type: "CUSTOMER_DOCUMENT" | "INVOICE" | "COMPANY_INVOICE";

  @ApiProperty()
  fileName: string;

  @ApiPropertyOptional({
    description: "Signed URL for client download/view",
    nullable: true,
  })
  fileUrl?: string | null;

  @ApiProperty()
  mimeType: string;

  @ApiPropertyOptional({ nullable: true })
  fileSizeBytes?: number | null;

  @ApiPropertyOptional({ nullable: true })
  uploadedByUserId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  uploadedByName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  generatedByUserId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  generatedByName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  generatedAt?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  sourceJobId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  sourceInvoiceId?: string | null;

  @ApiProperty()
  uploadedAt: Date;

  @ApiProperty({ enum: ["ACTIVE", "DELETED"] })
  status: "ACTIVE" | "DELETED";
}

export class CustomerCompanyDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  email?: string | null;

  @ApiPropertyOptional()
  phone?: string | null;

  @ApiPropertyOptional()
  addressLine1?: string | null;

  @ApiPropertyOptional()
  addressLine2?: string | null;

  @ApiPropertyOptional()
  postalCode?: string | null;

  @ApiPropertyOptional()
  country?: string | null;

  @ApiPropertyOptional()
  billingSameAsAddress?: boolean;

  @ApiPropertyOptional()
  billingAddressLine1?: string | null;

  @ApiPropertyOptional()
  billingAddressLine2?: string | null;

  @ApiPropertyOptional()
  billingPostalCode?: string | null;

  @ApiPropertyOptional()
  billingCountry?: string | null;

  @ApiPropertyOptional()
  picName?: string | null;

  @ApiPropertyOptional()
  picMobile?: string | null;

  @ApiPropertyOptional()
  picEmail?: string | null;

  @ApiPropertyOptional()
  uen?: string | null;

  @ApiPropertyOptional()
  notes?: string | null;

  @ApiPropertyOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: "Number of contacts under this company" })
  contactCount?: number;

  @ApiPropertyOptional({ description: "Number of portal users linked to this company" })
  userCount?: number;

  @ApiPropertyOptional({
    description:
      "Present on create when the current quotation base template was deep-copied into a customer rate template",
  })
  seededCustomerRateTemplate?: {
    id: string;
    name: string;
    rowCount: number;
    sourceMasterDatasetVersionNo: number | null;
    sourceMasterDatasetId?: string | null;
  } | null;
}

export class CustomerContactDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional()
  mobile?: string | null;
}

export class CreateCustomerCompanyDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  postalCode?: string;

  @ApiPropertyOptional({ default: "SG" })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  billingSameAsAddress?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingAddressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingAddressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingPostalCode?: string;

  @ApiPropertyOptional({ default: "SG" })
  @IsOptional()
  @IsString()
  billingCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  picName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  picMobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  picEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  uen?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    enum: [
      "PROSPECT",
      "PENDING_COMMERCIAL_APPROVAL",
      "ACTIVE",
      "SUSPENDED",
    ],
    default: "PROSPECT",
    description:
      "Commercial lifecycle. Missing signed quotation may block ACTIVE, not customer create.",
  })
  @IsOptional()
  @IsIn([
    "PROSPECT",
    "PENDING_COMMERCIAL_APPROVAL",
    "ACTIVE",
    "SUSPENDED",
  ])
  commercialStatus?:
    | "PROSPECT"
    | "PENDING_COMMERCIAL_APPROVAL"
    | "ACTIVE"
    | "SUSPENDED";

  @ApiPropertyOptional({
    type: [RateTemplateRowInputDto],
    description:
      "Optional customized default-rate rows seeded atomically with the customer. When omitted, the current quotation base is copied in full.",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RateTemplateRowInputDto)
  defaultRateRows?: RateTemplateRowInputDto[];

  @ApiPropertyOptional({
    description:
      "Compatibility flag: when true, customer create skips seeding a legacy CustomerRateTemplate. Required for the first-quotation onboarding flow; does not affect Job Charge sourcing from accepted quotations.",
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  skipDefaultRateTemplate?: boolean;

  @ApiPropertyOptional({
    description:
      "Stable client operation key for idempotent customer onboarding create/retries.",
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  onboardingOperationKey?: string;
}

export class UpdateCustomerCompanyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  postalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  billingSameAsAddress?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingAddressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingAddressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingPostalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  picName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  picMobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  picEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  uen?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    enum: [
      "PROSPECT",
      "PENDING_COMMERCIAL_APPROVAL",
      "ACTIVE",
      "SUSPENDED",
    ],
  })
  @IsOptional()
  @IsIn([
    "PROSPECT",
    "PENDING_COMMERCIAL_APPROVAL",
    "ACTIVE",
    "SUSPENDED",
  ])
  commercialStatus?:
    | "PROSPECT"
    | "PENDING_COMMERCIAL_APPROVAL"
    | "ACTIVE"
    | "SUSPENDED";
}

export class CreateCustomerContactDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mobile?: string;
}

export class CustomerCompanyUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional()
  name?: string | null;

  @ApiPropertyOptional({ description: "Tenant membership status (Active/Invited/Suspended)" })
  status?: string | null;
}

export class CreateCustomerCompanyUserDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ description: "Portal user display name (required)" })
  @IsString()
  @MinLength(1, { message: "name is required" })
  name!: string;

  @ApiProperty({ description: "Initial password set by admin" })
  @IsString()
  @MinLength(8)
  password!: string;

  // keep if you had it, but we won't use it now
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean;
}
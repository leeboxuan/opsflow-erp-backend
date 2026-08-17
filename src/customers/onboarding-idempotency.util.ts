import { hashRequestPayload } from "../shared/idempotency/idempotency.util";
import type { CreateCustomerCompanyDto } from "./dto/customers.dto";
import type {
  CreateBlankCustomerQuotationDto,
  CustomerQuotationLineInputDto,
} from "./customer-quotations/customer-quotations.dto";

export function hashCustomerOnboardingPayload(
  dto: CreateCustomerCompanyDto,
): string {
  const {
    onboardingOperationKey: _key,
    defaultRateRows: _rows,
    skipDefaultRateTemplate: _skip,
    ...payload
  } = dto;
  return hashRequestPayload(payload);
}

export function hashFirstQuotationBlankPayload(
  dto: CreateBlankCustomerQuotationDto,
): string {
  const { onboardingQuotationKey: _key, ...payload } = dto;
  return hashRequestPayload(payload);
}

export function hashFirstQuotationLinesPayload(
  lines: CustomerQuotationLineInputDto[],
): string {
  return hashRequestPayload(
    lines.map((line) => ({
      sortOrder: line.sortOrder ?? 0,
      code: line.code,
      label: line.label,
      description: line.description ?? null,
      unit: line.unit ?? null,
      qty: line.qty ?? 1,
      unitPriceCents: line.unitPriceCents ?? 0,
      currency: line.currency ?? "SGD",
      taxCode: line.taxCode ?? null,
      taxRate: line.taxRate ?? null,
      requiresManualAmount: line.requiresManualAmount ?? false,
      sourceTemplateRowId: line.sourceTemplateRowId ?? null,
      sourceMasterRowId: line.sourceMasterRowId ?? null,
      metadataJson: line.metadataJson ?? null,
    })),
  );
}

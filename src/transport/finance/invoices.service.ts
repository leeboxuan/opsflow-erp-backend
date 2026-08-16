import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";
import {
  parsePaginationFromQuery,
  buildPaginationMeta,
} from "../../shared/common/pagination";
import { applyMappedFilter } from "../../shared/common/listing/listing.filters";
import { buildOrderBy } from "../../shared/common/listing/listing.sort";
import { applyQSearch } from "../../shared/common/listing/listing.search";
import { CreateInvoiceDto, InvoiceDto } from "./dto/invoice.dto";
import { InvoicePrefillResponseDto } from "./dto/invoice.dto";
import { PortalInvoiceDto } from "./dto/portal-invoice.dto";
import {
  CustomerQuotationStatus,
  JobStatus,
  OrderStatus,
  Prisma,
  Role,
  TripStatus,
} from "@prisma/client";
import { SupabaseService } from "../../shared/auth/supabase.service";
import { actorIsCustomerAdmin } from "../../shared/auth/access-actor";
import { hasRole } from "../../shared/auth/canonical-tenant-role";
import { CanonicalTenantRole } from "@prisma/client";
import { AuditService } from "../../shared/audit/audit.service";
import { loadInvoiceAssetBuffer, renderInvoiceHtml } from "./invoice-render";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { evaluateJobInvoiceReadiness } from "../jobs/job-invoice-readiness";
import { buildTripDisplayRef } from "../trips/trip-display-ref";
import { RealtimeEventsService } from "../../shared/realtime/realtime-events.service";
import * as rt from "../../shared/realtime/realtime-publish";
import {
  canMarkInvoicePaid,
  canVoidInvoice,
  INVOICE_STATUS,
  isInvoiceDraft,
  isInvoiceEditable,
  isInvoiceGenerated,
  isInvoiceIssued,
  isInvoicePaid,
  isInvoiceRecognized,
  isInvoiceReserving,
  isInvoiceVoid,
  jobChargeAlreadyBilledMessage,
  mixedQuotationMessage,
  quotationMismatchMessage,
  resolveInvoiceSourceJobIds,
  uniqueNonEmptyIds,
} from "./invoice-integrity";
import {
  assertGeneratedFrozenArtifact,
  canIssueInvoice,
  invoiceCannotGenerateFromStatusMessage,
  invoiceMustGenerateBeforeIssueMessage,
  invoiceMustIssueBeforePaidMessage,
  paidInvoicesCannotBeVoidedMessage,
} from "./invoice-status";

const INVOICE_DOCUMENTS_BUCKET = "invoice-documents";

function toBasisPoints(rate: number) {
  return Math.round(rate);
}

function extractDraftMeta(snapshot: any) {
  const s = snapshot ?? {};
  return {
    orderIds: Array.isArray(s.orderIds) ? (s.orderIds as string[]) : [],
    sourceJobIds: Array.isArray(s.sourceJobIds)
      ? (s.sourceJobIds as string[])
      : [],
    confirmedAt: s.confirmedAt ? new Date(s.confirmedAt) : null,
    confirmedByUserId: s.confirmedByUserId ?? null,
  };
}

function normalizeCustomerCompanyName(name: string): string {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function firstText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}
@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private supabaseService: SupabaseService,
    private readonly audit: AuditService,
    @Optional() private readonly realtime?: RealtimeEventsService,
  ) {}

  private readonly PDF_SIGNED_URL_TTL_SECONDS = 60 * 10;

  private safeFileName(value: string) {
    return value
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  private getCustomerCompanyIdOrThrow(user: any): string {
    if (!actorIsCustomerAdmin(user)) {
      throw new ForbiddenException("Access denied");
    }
    const customerCompanyId = user?.customerCompanyId;
    if (!customerCompanyId) {
      throw new ForbiddenException(
        "CUSTOMER user is missing customerCompanyId",
      );
    }
    return customerCompanyId;
  }

  private assertCustomerCanOnlyRead(user: any) {
    if (!actorIsCustomerAdmin(user)) return;
    // Ensure we throw ForbiddenException when customerCompanyId is missing too.
    this.getCustomerCompanyIdOrThrow(user);
    throw new ForbiddenException(
      "CUSTOMER users are only allowed to read invoices",
    );
  }

  private async assertCanAccessInvoice(tenantId: string, inv: any, user: any) {
    if (!actorIsCustomerAdmin(user)) return;
    const customerCompanyId = this.getCustomerCompanyIdOrThrow(user);
    const allowed = await this.invoiceBelongsToCustomerCompany(
      tenantId,
      inv,
      customerCompanyId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not allowed to access this invoice");
    }
  }

  private toIsoDateOnly(d: Date): string {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  }

  private computeInvoiceTotals(lineItems: Array<{
    qty: number;
    unitPriceCents: number | null | undefined;
    taxRate: number;
  }>) {
    const normalized = lineItems.map((l) => {
      const unitPriceCents = Number(l.unitPriceCents ?? 0);
      const amountCents = l.qty * unitPriceCents;
      const taxCents =
        l.taxRate > 0 ? Math.round((amountCents * l.taxRate) / 10000) : 0;
      return { ...l, unitPriceCents, amountCents, taxCents };
    });
    const subtotalCents = normalized.reduce((s, l) => s + l.amountCents, 0);
    const taxCents = normalized.reduce((s, l) => s + l.taxCents, 0);
    const totalCents = subtotalCents + taxCents;
    return { normalized, subtotalCents, taxCents, totalCents };
  }

  private invoiceLineCreateData(tenantId: string, l: any) {
    return {
      tenantId,
      description: l.description,
      qty: l.qty,
      unitPriceCents: l.unitPriceCents,
      amountCents: l.amountCents,
      taxCode: l.taxCode,
      taxRate: l.taxRate,
      taxCents: l.taxCents,
      sourceType: l.sourceType ?? "MANUAL",
      jobChargeId: l.jobChargeId ?? null,
      sourceMasterItemId: l.sourceMasterItemId ?? null,
      sourceTripId: l.sourceTripId ?? null,
      tripDisplayRefSnapshot: l.tripDisplayRef ?? null,
      requiresManualAmount: Boolean(l.requiresManualAmount),
    };
  }

  private isUniqueConstraint(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    );
  }

  private async lockJobChargesForUpdate(
    tx: any,
    tenantId: string,
    jobChargeIds: string[],
  ): Promise<
    Array<{
      id: string;
      jobId: string;
      label: string;
      job: {
        id: string;
        internalRef: string;
        status: JobStatus;
        invoiceReadyAt: Date | null;
        customerCompanyId: string;
        sourceCustomerQuotationId: string | null;
      };
    }>
  > {
    const ids = uniqueNonEmptyIds(jobChargeIds);
    if (!ids.length) return [];
    if (typeof tx.$executeRaw === "function") {
      await tx.$executeRaw`
        SELECT id FROM job_charges
        WHERE "tenantId" = ${tenantId}
          AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}`))})
        FOR UPDATE
      `;
    }
    return tx.jobCharge.findMany({
      where: { tenantId, id: { in: ids } },
      select: {
        id: true,
        jobId: true,
        label: true,
        job: {
          select: {
            id: true,
            internalRef: true,
            status: true,
            invoiceReadyAt: true,
            customerCompanyId: true,
            sourceCustomerQuotationId: true,
          },
        },
      },
    });
  }

  private async assertJobChargesFreeForInvoice(
    tx: any,
    tenantId: string,
    jobChargeIds: string[],
    excludeInvoiceId?: string | null,
  ): Promise<void> {
    const ids = uniqueNonEmptyIds(jobChargeIds);
    if (!ids.length) return;
    const charges = await this.lockJobChargesForUpdate(tx, tenantId, ids);
    if (charges.length !== ids.length) {
      throw new BadRequestException("Some JobCharges were not found under this tenant");
    }
    const reservations = await tx.invoiceChargeReservation.findMany({
      where: {
        tenantId,
        jobChargeId: { in: ids },
        ...(excludeInvoiceId ? { invoiceId: { not: excludeInvoiceId } } : {}),
      },
      select: { jobChargeId: true },
    });
    if (reservations.length) {
      throw new BadRequestException(
        jobChargeAlreadyBilledMessage(
          uniqueNonEmptyIds(reservations.map((row: any) => row.jobChargeId)),
        ),
      );
    }
    const lines = await tx.invoiceLineItem.findMany({
      where: {
        tenantId,
        jobChargeId: { in: ids },
        ...(excludeInvoiceId ? { invoiceId: { not: excludeInvoiceId } } : {}),
      },
      select: {
        jobChargeId: true,
        invoice: { select: { id: true, status: true } },
      },
    });
    const billed = lines.filter(
      (line: any) =>
        line.jobChargeId && isInvoiceReserving(line.invoice?.status),
    );
    if (billed.length) {
      throw new BadRequestException(
        jobChargeAlreadyBilledMessage(
          uniqueNonEmptyIds(billed.map((line: any) => line.jobChargeId)),
        ),
      );
    }
  }

  private async assertQuotationBoundaryForCharges(
    tenantId: string,
    customerCompanyId: string | null,
    sourceCustomerQuotationId: string | null,
    charges: Array<{
      job: {
        customerCompanyId: string;
        sourceCustomerQuotationId: string | null;
        status: JobStatus;
      };
    }>,
  ): Promise<string | null> {
    if (!charges.length) return sourceCustomerQuotationId;
    const quotationIds = uniqueNonEmptyIds(
      charges.map((c) => c.job.sourceCustomerQuotationId),
    );
    const hasUnbound = charges.some((c) => !c.job.sourceCustomerQuotationId);
    if (quotationIds.length > 1 || (quotationIds.length === 1 && hasUnbound)) {
      throw new BadRequestException(mixedQuotationMessage());
    }
    const derived = quotationIds[0] ?? null;
    const bound = sourceCustomerQuotationId || derived;
    if (sourceCustomerQuotationId && derived && sourceCustomerQuotationId !== derived) {
      throw new BadRequestException(quotationMismatchMessage());
    }
    if (sourceCustomerQuotationId && hasUnbound) {
      throw new BadRequestException(quotationMismatchMessage());
    }
    if (bound) {
      const quotation = await this.prisma.customerQuotation.findFirst({
        where: { id: bound, tenantId },
        select: { id: true, customerCompanyId: true, status: true },
      });
      if (!quotation) {
        throw new BadRequestException("Commercial quotation not found under this tenant");
      }
      if (customerCompanyId && quotation.customerCompanyId !== customerCompanyId) {
        throw new BadRequestException(
          "Commercial quotation must belong to the invoice customer",
        );
      }
      for (const charge of charges) {
        if (charge.job.customerCompanyId !== quotation.customerCompanyId) {
          throw new BadRequestException(
            "JobCharges must belong to the same customer as the commercial quotation",
          );
        }
      }
    }
    return bound;
  }

  private async syncInvoiceChargeReservations(
    tx: any,
    tenantId: string,
    invoiceId: string,
    jobChargeIds: string[],
  ): Promise<void> {
    await tx.invoiceChargeReservation.deleteMany({
      where: { tenantId, invoiceId },
    });
    const ids = uniqueNonEmptyIds(jobChargeIds);
    if (!ids.length) return;
    try {
      await tx.invoiceChargeReservation.createMany({
        data: ids.map((jobChargeId) => ({ tenantId, invoiceId, jobChargeId })),
      });
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        throw new BadRequestException(
          "One or more JobCharges are already billed on an active invoice",
        );
      }
      throw error;
    }
  }

  private async releaseInvoiceChargeReservations(
    tx: any,
    tenantId: string,
    invoiceId: string,
  ): Promise<void> {
    await tx.invoiceChargeReservation.deleteMany({
      where: { tenantId, invoiceId },
    });
  }

  private async syncJobsAfterChargeReservationChange(
    tx: any,
    tenantId: string,
    jobIds: string[],
  ): Promise<void> {
    const ids = uniqueNonEmptyIds(jobIds);
    if (!ids.length) return;
    const jobs = await tx.job.findMany({
      where: { tenantId, id: { in: ids } },
      select: {
        id: true,
        status: true,
        invoiceReadyAt: true,
        charges: { select: { id: true } },
      },
    });
    const chargeIds = jobs.flatMap((job: any) =>
      (job.charges ?? []).map((c: any) => c.id),
    );
    const reservations = chargeIds.length
      ? await tx.invoiceChargeReservation.findMany({
          where: { tenantId, jobChargeId: { in: chargeIds } },
          include: { invoice: { select: { status: true } } },
        })
      : [];
    const recognizedReserved = new Set(
      reservations
        .filter((row: any) => isInvoiceRecognized(row.invoice?.status))
        .map((row: any) => row.jobChargeId),
    );
    const anyReserved = new Set(
      reservations
        .filter((row: any) => isInvoiceReserving(row.invoice?.status))
        .map((row: any) => row.jobChargeId),
    );
    for (const job of jobs) {
      if (job.status === JobStatus.CANCELLED) continue;
      const jobChargeIds = (job.charges ?? []).map((c: any) => c.id);
      if (!jobChargeIds.length) continue;
      const remaining = jobChargeIds.filter((id: string) => !anyReserved.has(id));
      const allRecognized =
        remaining.length === 0 &&
        jobChargeIds.every((id: string) => recognizedReserved.has(id));
      if (
        allRecognized &&
        (job.status === JobStatus.READY_FOR_INVOICE || job.invoiceReadyAt)
      ) {
        await tx.job.update({
          where: { id: job.id },
          data: { status: JobStatus.COMPLETED, completedAt: new Date() },
        });
      } else if (
        job.status === JobStatus.COMPLETED &&
        job.invoiceReadyAt &&
        remaining.length > 0
      ) {
        await tx.job.update({
          where: { id: job.id },
          data: { status: JobStatus.READY_FOR_INVOICE, completedAt: null },
        });
      }
    }
  }

  private async prepareInvoiceChargeBinding(
    tx: any,
    tenantId: string,
    dto: {
      customerCompanyId?: string | null;
      sourceCustomerQuotationId?: string | null;
      sourceJobId?: string | null;
      sourceJobIds?: string[] | null;
    },
    lines: Array<{ jobChargeId?: string | null }>,
    excludeInvoiceId?: string | null,
  ): Promise<{
    jobChargeIds: string[];
    boundQuotationId: string | null;
    sourceJobIds: string[];
  }> {
    const jobChargeIds = uniqueNonEmptyIds(lines.map((l) => l.jobChargeId));
    await this.assertJobChargesFreeForInvoice(
      tx,
      tenantId,
      jobChargeIds,
      excludeInvoiceId,
    );
    let boundQuotationId = dto.sourceCustomerQuotationId ?? null;
    let sourceJobIds = resolveInvoiceSourceJobIds({
      sourceJobId: dto.sourceJobId,
      sourceJobIds: dto.sourceJobIds,
    });
    if (jobChargeIds.length) {
      const charges = await this.lockJobChargesForUpdate(tx, tenantId, jobChargeIds);
      for (const charge of charges) {
        if (charge.job.status === JobStatus.CANCELLED) {
          throw new BadRequestException(
            `Cancelled jobs cannot be invoiced (${charge.job.internalRef})`,
          );
        }
        if (
          dto.customerCompanyId &&
          charge.job.customerCompanyId !== dto.customerCompanyId
        ) {
          throw new BadRequestException(
            "JobCharges must belong to the invoice customer",
          );
        }
      }
      boundQuotationId = await this.assertQuotationBoundaryForCharges(
        tenantId,
        dto.customerCompanyId ?? null,
        boundQuotationId,
        charges,
      );
      sourceJobIds = uniqueNonEmptyIds([
        ...sourceJobIds,
        ...charges.map((c) => c.jobId),
      ]);
    }
    return { jobChargeIds, boundQuotationId, sourceJobIds };
  }

  private isBillableTripStatus(status: TripStatus): boolean {
    return status === TripStatus.COMPLETED || status === TripStatus.DONE;
  }

  private buildTripLineLabels(trip: any): { fromLabel: string; toLabel: string } {
    const fromLabel = firstText(
      trip?.originLabel,
      trip?.originAddressLine1,
      trip?.originAddressLine2,
      "Origin",
    ) as string;
    const toLabel = firstText(
      trip?.destinationLabel,
      trip?.destinationAddressLine1,
      trip?.destinationAddressLine2,
      "Destination",
    ) as string;
    return { fromLabel, toLabel };
  }

  private buildTripLineDescription(
    tripDisplayRef: string,
    fromLabel: string,
    toLabel: string,
  ): string {
    return `${tripDisplayRef}\nFrom: ${fromLabel}\nTo: ${toLabel}`;
  }

  private async resolveQuotationOptionsForCompany(
    tenantId: string,
    companyId: string,
  ): Promise<Array<{
    id: string;
    code: string;
    label: string;
    description: string | null;
    unit: string | null;
    rateCents: number | null;
    unitPriceCents: number | null;
    requiresManualAmount: boolean;
    taxRate: number;
    rawRateText: string | null;
    sourceMasterFileId: string | null;
  }>> {
    const rateMasterLines = await this.prisma.customerRateMasterLine.findMany({
      where: {
        tenantId,
        customerCompanyId: companyId,
        active: true,
        isSelectableForJob: true,
      },
      orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
    });

    if (rateMasterLines.length > 0) {
      return rateMasterLines.map((r: any) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        description: r.description ?? null,
        unit: r.unit ?? null,
        rateCents: r.rateCents ?? null,
        unitPriceCents: r.rateCents ?? null,
        requiresManualAmount: Boolean(r.requiresManualAmount || r.rateCents == null),
        taxRate: 0.09,
        rawRateText: r.rawRateText ?? null,
        sourceMasterFileId: null,
      }));
    }

    const fallback = await this.prisma.customerQuotationRateLine.findMany({
      where: {
        tenantId,
        quotation: {
          customerCompanyId: companyId,
          status: "ACTIVE",
        },
      },
      include: {
        quotation: { select: { id: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });

    if (fallback.length > 0) {
      return fallback.map((r: any) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        description: r.description ?? null,
        unit: r.unit ?? null,
        rateCents: r.rateCents ?? null,
        unitPriceCents: r.rateCents ?? null,
        requiresManualAmount: Boolean(r.requiresManualAmount || r.rateCents == null),
        taxRate: 0.09,
        rawRateText: r.rawRateText ?? null,
        sourceMasterFileId: r.quotation?.id ?? null,
      }));
    }

    const tenantQuotationRows = await this.prisma.masterRateDatasetRow.findMany({
      where: {
        tenantId,
        isActive: true,
        dataset: {
          tenantId,
          type: "QUOTATION",
          status: "ACTIVE",
        },
      },
      include: {
        dataset: { select: { id: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });

    return tenantQuotationRows.map((r: any) => {
      const rateCents = Number.isInteger(r.rateCents) ? r.rateCents : null;
      return {
        id: r.id,
        code: String(r.code ?? "").trim(),
        label:
          firstText(
            r.label,
            r.description,
            r.code,
            "Quotation item",
          ) ?? "Quotation item",
        description: firstText(r.description, r.label) ?? null,
        unit: firstText(r.unit, "trip"),
        rateCents,
        unitPriceCents: rateCents,
        requiresManualAmount: Boolean(r.requiresManualAmount || rateCents == null),
        taxRate: 0.09,
        rawRateText: r.rawRateText ?? null,
        sourceMasterFileId: r.dataset?.id ?? null,
      };
    });
  }

  async listQuotationOptionsByCompany(tenantId: string, companyId: string, user: any) {
    this.assertCustomerCanOnlyRead(user);
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new BadRequestException("Customer company not found");
    const items = await this.resolveQuotationOptionsForCompany(tenantId, companyId);
    return { items };
  }

  async listInvoiceableJobsByCompany(tenantId: string, companyId: string, user: any) {
    this.assertCustomerCanOnlyRead(user);
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new BadRequestException("Customer company not found");

    const jobs = await this.prisma.job.findMany({
      where: {
        tenantId,
        customerCompanyId: companyId,
        status: { not: JobStatus.CANCELLED },
      },
      include: {
        trips: { select: { id: true, status: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    const jobIds = jobs.map((j) => j.id);
    const reservedChargeIds = new Set<string>();
    const chargeIdsByJobId = new Map<string, string[]>();
    const latestInvoiceByJobId = new Map<
      string,
      { id: string; status: string; sourceJobId: string | null }
    >();
    if (jobIds.length) {
      const invoices = await this.prisma.invoice.findMany({
        where: { tenantId, sourceJobId: { in: jobIds } },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, sourceJobId: true },
      });
      for (const inv of invoices) {
        const sourceJobId = inv.sourceJobId;
        if (!sourceJobId || latestInvoiceByJobId.has(sourceJobId)) continue;
        latestInvoiceByJobId.set(sourceJobId, inv);
      }
      const charges = await this.prisma.jobCharge.findMany({
        where: { tenantId, jobId: { in: jobIds } },
        select: { id: true, jobId: true },
      });
      for (const c of charges) {
        chargeIdsByJobId.set(c.jobId, [...(chargeIdsByJobId.get(c.jobId) ?? []), c.id]);
      }
      const chargeIds = charges.map((c) => c.id);
      if (chargeIds.length && this.prisma.invoiceChargeReservation) {
        const reservations = await this.prisma.invoiceChargeReservation.findMany({
          where: { tenantId, jobChargeId: { in: chargeIds } },
          select: { jobChargeId: true },
        });
        for (const row of reservations) reservedChargeIds.add(row.jobChargeId);
      }
    }

    const items: any[] = [];
    for (const job of jobs) {
      const readiness = evaluateJobInvoiceReadiness(
        (job.trips ?? []).map((t: any) => ({ id: t.id, status: t.status as TripStatus })),
      );
      if (!readiness.readyForInvoice) continue;

      const existingInvoice = latestInvoiceByJobId.get(job.id) ?? null;
      const jobChargeIds = chargeIdsByJobId.get(job.id) ?? [];
      const remainingCharges = jobChargeIds.filter((id) => !reservedChargeIds.has(id));
      if (jobChargeIds.length > 0 && remainingCharges.length === 0) {
        continue;
      }

      const completedTripCount = (job.trips ?? []).filter((t: any) =>
        t.status === TripStatus.COMPLETED || t.status === TripStatus.DONE).length;
      const billableTripCount = completedTripCount;

      items.push({
        id: job.id,
        internalJobReference: job.internalRef,
        customerReference: job.externalRef ?? null,
        jobType: job.jobType,
        status: job.status,
        invoiceReadyAt: job.invoiceReadyAt ?? null,
        tripCount: (job.trips ?? []).length,
        completedTripCount,
        billableTripCount,
        existingInvoiceId: existingInvoice?.id ?? null,
        existingInvoiceStatus: existingInvoice?.status ?? null,
        label: `${job.internalRef} · ${job.externalRef ?? "-"} · ${job.jobType}`,
      });
    }
    return { items };
  }

  async listCommercialAgreementsByCompany(
    tenantId: string,
    companyId: string,
    user: any,
  ) {
    this.assertCustomerCanOnlyRead(user);
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true },
    });
    if (!company) throw new BadRequestException("Customer company not found");
    const items = await this.prisma.customerQuotation.findMany({
      where: {
        tenantId,
        customerCompanyId: companyId,
        status: CustomerQuotationStatus.ACCEPTED,
      },
      select: {
        id: true,
        quotationNo: true,
        title: true,
        status: true,
        currency: true,
        acceptedAt: true,
      },
      orderBy: [{ acceptedAt: "desc" }, { quotationNo: "desc" }],
    });
    return { items };
  }

  async listInvoiceableChargesByCompany(
    tenantId: string,
    companyId: string,
    user: any,
    quotationId?: string | null,
  ) {
    this.assertCustomerCanOnlyRead(user);
    const company = await this.prisma.customer_companies.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true, name: true },
    });
    if (!company) throw new BadRequestException("Customer company not found");
    const jobs = await this.prisma.job.findMany({
      where: {
        tenantId,
        customerCompanyId: companyId,
        status: { not: JobStatus.CANCELLED },
        ...(quotationId
          ? { sourceCustomerQuotationId: quotationId }
          : {}),
      },
      include: {
        trips: { select: { id: true, status: true } },
        sourceCustomerQuotation: {
          select: { id: true, quotationNo: true, title: true, status: true },
        },
        charges: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
      orderBy: [{ updatedAt: "desc" }],
    });
    const chargeIds = jobs.flatMap((j) => (j.charges ?? []).map((c) => c.id));
    const reserved = new Set<string>();
    if (chargeIds.length && this.prisma.invoiceChargeReservation) {
      const rows = await this.prisma.invoiceChargeReservation.findMany({
        where: { tenantId, jobChargeId: { in: chargeIds } },
        select: { jobChargeId: true },
      });
      for (const row of rows) reserved.add(row.jobChargeId);
    }
    const items: any[] = [];
    for (const job of jobs) {
      const readiness = evaluateJobInvoiceReadiness(
        (job.trips ?? []).map((t: any) => ({ id: t.id, status: t.status as TripStatus })),
      );
      if (!readiness.readyForInvoice && job.status !== JobStatus.READY_FOR_INVOICE && !job.invoiceReadyAt) {
        continue;
      }
      for (const charge of job.charges ?? []) {
        if (reserved.has(charge.id)) continue;
        items.push({
          jobChargeId: charge.id,
          jobId: job.id,
          jobInternalRef: job.internalRef,
          jobExternalRef: job.externalRef ?? null,
          jobStatus: job.status,
          sourceCustomerQuotationId: job.sourceCustomerQuotationId ?? null,
          quotationNo: job.sourceCustomerQuotation?.quotationNo ?? null,
          sourceType: charge.sourceType,
          code: charge.code,
          label: charge.label,
          description: charge.description ?? null,
          qty: charge.qty,
          unitPriceCents: charge.unitPriceCents,
          amountCents: charge.amountCents,
          taxCode: charge.taxable ? charge.taxCode || "SR" : "ZR",
          taxRate: charge.taxRateBasisPoints ?? (charge.taxable ? 900 : 0),
          tripId: null,
        });
      }
    }
    return {
      customerCompanyId: company.id,
      customerName: company.name,
      items,
    };
  }

  private async validateInvoiceLineSources(
    tenantId: string,
    customerCompanyId: string | null,
    sourceJobId: string | null,
    lineItems: Array<any>,
  ): Promise<void> {
    const quotationOptionsCache = new Map<string, Set<string>>();
    const getQuotationOptionIds = async (companyId: string): Promise<Set<string>> => {
      const cached = quotationOptionsCache.get(companyId);
      if (cached) return cached;
      const options = await this.resolveQuotationOptionsForCompany(tenantId, companyId);
      const ids = new Set(
        (options ?? [])
          .map((item: any) => String(item?.id ?? "").trim())
          .filter(Boolean),
      );
      quotationOptionsCache.set(companyId, ids);
      return ids;
    };

    const resolveCompanyIdForLine = async (line: any): Promise<string | null> => {
      const fromLine = String(line?.customerCompanyId ?? customerCompanyId ?? "").trim();
      if (fromLine) return fromLine;
      const jobIdForCompany = String(line?.sourceJobId ?? sourceJobId ?? "").trim();
      if (!jobIdForCompany) return null;
      const job = await this.prisma.job.findFirst({
        where: { id: jobIdForCompany, tenantId },
        select: { customerCompanyId: true },
      });
      return job?.customerCompanyId ?? null;
    };

    const validateQuotationSourceItemForInvoice = async (
      line: any,
      requireSourceMaster = true,
    ): Promise<void> => {
      const sourceMasterItemId = String(line?.sourceMasterItemId ?? "").trim();
      if (!sourceMasterItemId) {
        if (requireSourceMaster) {
          throw new BadRequestException("sourceMasterItemId is required for QUOTATION_MASTER");
        }
        return;
      }
      const companyId = await resolveCompanyIdForLine(line);
      if (!companyId) {
        throw new BadRequestException(
          "customerCompanyId is required for quotation master validation",
        );
      }
      const validIds = await getQuotationOptionIds(companyId);
      if (!validIds.has(sourceMasterItemId)) {
        throw new BadRequestException("Invalid quotation source line item");
      }
    };

    for (const line of lineItems) {
      const sourceType = String(line.sourceType ?? "MANUAL").toUpperCase();
      const resolvedSourceJobId = String(line.sourceJobId ?? sourceJobId ?? "").trim() || null;
      if (!["MANUAL", "JOB", "QUOTATION_MASTER", "TRIP"].includes(sourceType)) {
        throw new BadRequestException(`Unsupported sourceType: ${sourceType}`);
      }
      if (sourceType === "QUOTATION_MASTER") {
        await validateQuotationSourceItemForInvoice(line, true);
      }
      if (sourceType === "JOB" && !resolvedSourceJobId) {
        throw new BadRequestException("sourceJobId is required for JOB line items");
      }
      if (sourceType === "TRIP") {
        if (!resolvedSourceJobId) {
          throw new BadRequestException("sourceJobId is required for TRIP line items");
        }
        const sourceTripId = String(line.sourceTripId ?? "").trim();
        if (!sourceTripId) {
          throw new BadRequestException("sourceTripId is required for TRIP line items");
        }
        const trip = await this.prisma.trip.findFirst({
          where: {
            id: sourceTripId,
            tenantId,
            jobId: resolvedSourceJobId,
          },
          select: { id: true, status: true },
        });
        if (!trip) {
          throw new BadRequestException("sourceTripId must belong to sourceJobId");
        }
        if (trip.status === TripStatus.CANCELLED) {
          throw new BadRequestException("Cancelled trips cannot be invoiced");
        }
        await validateQuotationSourceItemForInvoice(line, false);
      }
    }
  }

  async getInvoicePrefillFromJob(
    tenantId: string,
    jobId: string,
    user: any,
  ): Promise<InvoicePrefillResponseDto> {
    this.assertCustomerCanOnlyRead(user);
    const job = await this.prisma.job.findFirst({
      where: { tenantId, id: jobId },
      include: {
        customerCompany: true,
        charges: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        trips: {
          select: {
            id: true,
            status: true,
            tripSequence: true,
            jobSequence: true,
            originLabel: true,
            originAddressLine1: true,
            originAddressLine2: true,
            destinationLabel: true,
            destinationAddressLine1: true,
            destinationAddressLine2: true,
          },
        },
      },
    });
    if (!job) throw new BadRequestException("Job not found");
    if (
      job.status !== JobStatus.READY_FOR_INVOICE &&
      !job.invoiceReadyAt
    ) {
      throw new BadRequestException("Job is not ready for invoice");
    }

    const existingDraft = await this.prisma.invoice.findFirst({
      where: { tenantId, sourceJobId: jobId, status: INVOICE_STATUS.DRAFT },
      include: { lineItems: true },
      orderBy: { createdAt: "desc" },
    });

    const today = new Date();
    const due = new Date(today);
    due.setDate(due.getDate() + 14);
    const taxRate = 900;
    const quotationOptions = await this.resolveQuotationOptionsForCompany(
      tenantId,
      job.customerCompanyId,
    );
    const billableTrips = (job.trips ?? []).filter((t: any) =>
      this.isBillableTripStatus(t.status as TripStatus),
    );
    const billableTripSummaries = billableTrips.map((trip: any) => {
      const tripDisplayRef = buildTripDisplayRef({
        jobInternalRef: job.internalRef,
        tripSequence: trip.tripSequence,
        jobSequence: trip.jobSequence,
        tripId: trip.id,
      });
      const { fromLabel, toLabel } = this.buildTripLineLabels(trip);
      return { tripId: trip.id, tripDisplayRef, fromLabel, toLabel };
    });

    if (existingDraft) {
      const amountDueCents = existingDraft.totalCents;
      return {
        job: {
          id: job.id,
          internalJobReference: job.internalRef,
          customerReference: job.externalRef ?? null,
          jobType: job.jobType,
          billableTripCount: billableTrips.length,
        },
        jobId,
        internalJobReference: job.internalRef,
        customerCompanyId: job.customerCompanyId,
        customerCompanyName: job.customerCompany?.name ?? "Customer",
        invoiceTemplate: (existingDraft as any).templateCode ?? "DB_WISDOM",
        invoiceDate: this.toIsoDateOnly(existingDraft.issueDate),
        dueDate: this.toIsoDateOnly(existingDraft.dueDate ?? due),
        reference: `${job.internalRef}${job.externalRef ? ` // ${job.externalRef}` : ""}`,
        currency: existingDraft.currency ?? "SGD",
        taxRate: taxRate / 10000,
        lineItems: existingDraft.lineItems.map((li: any) => ({
          sourceJobId: (existingDraft as any).sourceJobId ?? job.id,
          jobChargeId: li.jobChargeId ?? null,
          description: li.description,
          qty: li.qty,
          unitPriceCents: li.unitPriceCents,
          taxCode: li.taxCode,
          taxRate: li.taxRate,
          sourceType: li.sourceType ?? "MANUAL",
          sourceMasterItemId: li.sourceMasterItemId ?? null,
          sourceTripId: li.sourceTripId ?? null,
          tripDisplayRef: li.tripDisplayRefSnapshot ?? null,
          requiresManualAmount: li.requiresManualAmount ?? false,
        })),
        subtotalCents: existingDraft.subtotalCents,
        taxCents: existingDraft.taxCents,
        totalCents: existingDraft.totalCents,
        amountDueCents,
        existingDraftInvoiceId: existingDraft.id,
        billableTrips: billableTripSummaries,
        quotationOptions,
      };
    }

    const templateCode = "WISDOM_FORCE";
    const chargeIds = (job.charges ?? []).map((c: any) => c.id);
    const reservedChargeIds = new Set<string>();
    if (chargeIds.length && this.prisma.invoiceChargeReservation) {
      const reserved = await this.prisma.invoiceChargeReservation.findMany({
        where: { tenantId, jobChargeId: { in: chargeIds } },
        select: { jobChargeId: true },
      });
      for (const row of reserved) reservedChargeIds.add(row.jobChargeId);
    }
    const eligibleCharges = (job.charges ?? []).filter(
      (c: any) => !reservedChargeIds.has(c.id),
    );
    if (eligibleCharges.length > 0) {
      const prefillFromCharges = eligibleCharges.map((c: any) => {
        const taxCode = c.taxable ? c.taxCode || "SR" : "ZR";
        const taxRateBp = c.taxRateBasisPoints ?? (c.taxable ? 900 : 0);
        return {
          sourceType: "JOB",
          sourceJobId: job.id,
          jobChargeId: c.id,
          sourceMasterItemId: null,
          sourceTripId: null,
          description: `${job.internalRef} — ${c.label}`,
          qty: c.qty,
          unitPriceCents: c.unitPriceCents,
          taxCode,
          taxRate: taxRateBp,
          requiresManualAmount: false,
          isEditable: true,
        };
      });
      const totals = this.computeInvoiceTotals(prefillFromCharges);
      return {
        job: {
          id: job.id,
          internalJobReference: job.internalRef,
          customerReference: job.externalRef ?? null,
          jobType: job.jobType,
          billableTripCount: billableTrips.length,
        },
        jobId,
        internalJobReference: job.internalRef,
        customerCompanyId: job.customerCompanyId,
        customerCompanyName: job.customerCompany?.name ?? "Customer",
        invoiceTemplate: templateCode,
        invoiceDate: this.toIsoDateOnly(today),
        dueDate: this.toIsoDateOnly(due),
        reference: `${job.internalRef}${job.externalRef ? ` // ${job.externalRef}` : ""}`,
        currency: "SGD",
        taxRate: taxRate / 10000,
        lineItems: prefillFromCharges,
        subtotalCents: totals.subtotalCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        amountDueCents: totals.totalCents,
        existingDraftInvoiceId: null,
        billableTrips: billableTripSummaries,
        quotationOptions,
        sourceCustomerQuotationId: (job as any).sourceCustomerQuotationId ?? null,
      };
    }
    const prefillLineItems: Array<any> = billableTripSummaries.map((trip) => {
      return {
        sourceType: "TRIP",
        sourceJobId: job.id,
        sourceMasterItemId: null,
        sourceTripId: trip.tripId,
        tripDisplayRef: trip.tripDisplayRef,
        fromLabel: trip.fromLabel,
        toLabel: trip.toLabel,
        description: this.buildTripLineDescription(
          trip.tripDisplayRef,
          trip.fromLabel,
          trip.toLabel,
        ),
        qty: 1,
        unitPriceCents: null,
        taxCode: "SR",
        taxRate,
        requiresManualAmount: true,
        isEditable: true,
      };
    });

    if (prefillLineItems.length === 0) {
      throw new BadRequestException("No billable trips found for invoice prefill");
    }

    const totals = this.computeInvoiceTotals(prefillLineItems);

    return {
      job: {
        id: job.id,
        internalJobReference: job.internalRef,
        customerReference: job.externalRef ?? null,
        jobType: job.jobType,
        billableTripCount: billableTrips.length,
      },
      jobId,
      internalJobReference: job.internalRef,
      customerCompanyId: job.customerCompanyId,
      customerCompanyName: job.customerCompany?.name ?? "Customer",
      invoiceTemplate: templateCode,
      invoiceDate: this.toIsoDateOnly(today),
      dueDate: this.toIsoDateOnly(due),
      reference: `${job.internalRef}${job.externalRef ? ` // ${job.externalRef}` : ""}`,
      currency: "SGD",
      taxRate: taxRate / 10000,
      lineItems: prefillLineItems,
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      amountDueCents: totals.totalCents,
      existingDraftInvoiceId: null,
      billableTrips: billableTripSummaries,
      quotationOptions,
    };
  }

  async listInvoices(
    tenantId: string,
    query?: {
      q?: string;
      filter?: string;
      status?: string;
      sortBy?: string;
      sortDir?: string;
      page?: unknown;
      pageSize?: unknown;
    },
    user?: any,
  ): Promise<{
    data: any[];
    meta: { page: number; pageSize: number; total: number };
  }> {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(
      query ?? {},
    );

    const where: any = { tenantId };
    const isCustomer = actorIsCustomerAdmin(user);
    const customerCompanyId = isCustomer
      ? this.getCustomerCompanyIdOrThrow(user)
      : null;
    applyQSearch(where, query?.q?.trim(), ["invoiceNo", "customerName"]);
    applyMappedFilter(where, query?.filter ?? (query as { status?: string })?.status, {
      Draft: { status: INVOICE_STATUS.DRAFT },
      DRAFT: { status: INVOICE_STATUS.DRAFT },
      Generated: { status: INVOICE_STATUS.GENERATED },
      GENERATED: { status: INVOICE_STATUS.GENERATED },
      Issued: { status: INVOICE_STATUS.ISSUED },
      ISSUED: { status: INVOICE_STATUS.ISSUED },
      Paid: { status: INVOICE_STATUS.PAID },
      PAID: { status: INVOICE_STATUS.PAID },
      Void: { status: INVOICE_STATUS.VOID },
      VOID: { status: INVOICE_STATUS.VOID },
    });

    const orderBy = buildOrderBy(
      query?.sortBy,
      query?.sortDir,
      [
        "createdAt",
        "updatedAt",
        "invoiceNo",
        "status",
        "issueDate",
        "issuedAt",
      ],
      { createdAt: "desc" },
    );

    const include = {
      lineItems: true,
      orders: { select: { id: true } },
    };

    if (!isCustomer) {
      const [total, invoices] = await this.prisma.$transaction([
        this.prisma.invoice.count({ where }),
        this.prisma.invoice.findMany({
          where,
          orderBy,
          skip,
          take,
          include,
        }),
      ]);

      // Keep lineItems in list DTOs (required by InvoiceDto / edit flows).
      // Batch confirmer/issuer user lookups for the page instead of N queries.
      const data = await this.toDtosWithNames(invoices);
      return { data, meta: buildPaginationMeta(page, pageSize, total) };
    }

    // CUSTOMER visibility is company-scoped and derived from invoice orders
    // and/or draft snapshot.orderIds (for unlinked draft scenarios).
    // Name-fallback membership means we cannot safely tighten SQL by
    // customerCompanyId alone without changing visibility.
    const customerCandidates = await this.prisma.invoice.findMany({
      where,
      orderBy,
      include: {
        lineItems: true,
        orders: { select: { id: true, customerCompanyId: true } },
      },
    });

    const visible = await this.filterInvoicesBelongingToCustomerCompany(
      tenantId,
      customerCandidates,
      customerCompanyId as string,
    );

    const total = visible.length;
    const pageItems = visible.slice(skip, skip + take);
    const data = await this.toDtosWithNames(pageItems);
    return { data, meta: buildPaginationMeta(page, pageSize, total) };
  }

  async getInvoice(tenantId: string, id: string, user: any) {
    const inv = await this.prisma.invoice.findFirst({
      where: { tenantId, id },
      include: {
        lineItems: true,
        orders: { select: { id: true, customerCompanyId: true } },
      },
    });

    if (!inv) throw new BadRequestException("Invoice not found");

    await this.assertCanAccessInvoice(tenantId, inv, user);
    return this.toDtoWithNames(inv);
  }

  async createInvoice(
    tenantId: string,
    dto: CreateInvoiceDto,
    user: any,
  ): Promise<InvoiceDto> {
    this.assertCustomerCanOnlyRead(user);
    const orderIds = dto.orderIds ?? [];
    if (!orderIds.length) {
      throw new BadRequestException(
        "orderIds is required to create a non-draft invoice",
      );
    }
    // Validate orders: belong to tenant, completed-ish, and not already invoiced
    const orders = await this.prisma.transportOrder.findMany({
      where: {
        tenantId,
        id: { in: orderIds },
      },
      select: { id: true, status: true, invoiceId: true, customerName: true },
    });

    if (orders.length !== orderIds.length) {
      throw new BadRequestException("Some orders not found under this tenant");
    }

    const bad = orders.find(
      (o) => o.invoiceId || o.status !== OrderStatus.Delivered,
    );
    if (bad) {
      throw new BadRequestException(
        "Orders must be Delivered/Closed and not already invoiced",
      );
    }

    await this.validateInvoiceLineSources(
      tenantId,
      dto.customerCompanyId ?? null,
      dto.sourceJobId ?? null,
      dto.lineItems ?? [],
    );

    // Compute totals from manual line items
    const normalized = dto.lineItems.map((l) => {
      const unitPriceCents = Number(l.unitPriceCents ?? 0);
      const amountCents = l.qty * unitPriceCents;
      const taxCents =
        l.taxRate > 0 ? Math.round((amountCents * l.taxRate) / 10000) : 0; // basis points
      return {
        ...l,
        unitPriceCents,
        amountCents,
        taxCents,
        taxRate: toBasisPoints(l.taxRate),
      };
    });

    const subtotalCents = normalized.reduce((s, l) => s + l.amountCents, 0);
    const taxCents = normalized.reduce((s, l) => s + l.taxCents, 0);
    const totalCents = subtotalCents + taxCents;

    const issueDate = dto.issueDateISO
      ? new Date(dto.issueDateISO + "T00:00:00")
      : new Date();
    const dueDate = dto.dueDateISO
      ? new Date(dto.dueDateISO + "T00:00:00")
      : null;

    // Generate invoice no: INV-YYYYMM-#### (good enough for MVP)
    const invoiceNo = await this.nextInvoiceNo(tenantId, issueDate);

    const created = await this.prisma.$transaction(async (tx) => {
      const binding = await this.prepareInvoiceChargeBinding(
        tx,
        tenantId,
        dto,
        normalized,
      );
      const inv = await tx.invoice.create({
        data: {
          tenantId,
          invoiceNo,
          customerName: dto.customerName,
          customerCompanyId: dto.customerCompanyId ?? null,
          sourceJobId: dto.sourceJobId ?? binding.sourceJobIds[0] ?? null,
          sourceCustomerQuotationId: binding.boundQuotationId,
          templateCode: dto.templateCode ?? "DB_WISDOM",
          currency: dto.currency ?? "SGD",
          issueDate,
          dueDate,
          notes: dto.notes ?? null,
          status: INVOICE_STATUS.DRAFT,
          subtotalCents,
          taxCents,
          totalCents,
          lineItems: {
            create: normalized.map((l) => this.invoiceLineCreateData(tenantId, l)),
          },
        },
        include: {
          lineItems: true,
        },
      });
      await this.syncInvoiceChargeReservations(
        tx,
        tenantId,
        inv.id,
        binding.jobChargeIds,
      );
      await this.syncJobsAfterChargeReservationChange(
        tx,
        tenantId,
        binding.sourceJobIds,
      );

      // Tag orders
      await tx.transportOrder.updateMany({
        where: { tenantId, id: { in: orderIds }, invoiceId: null },
        data: { invoiceId: inv.id, status: OrderStatus.Closed },
      });

      const invWithOrders = await tx.invoice.findFirst({
        where: { tenantId, id: inv.id },
        include: { lineItems: true, orders: { select: { id: true } } },
      });

      if (!invWithOrders)
        throw new BadRequestException("Failed to create invoice");
      return invWithOrders;
    });

    await this.audit.log(
      tenantId,
      "INVOICE_CREATED",
      "INVOICE",
      created.id,
      {
        invoiceNo: created.invoiceNo,
        path: "legacy_orders",
        sourceJobId: dto.sourceJobId ?? null,
      },
      user?.userId ?? null,
    );
    rt.publishInvoiceEvent(this.realtime, "invoice.created", tenantId, created.id, {
      jobId: dto.sourceJobId ?? null,
    });

    return this.toDtoWithNames(created);
  }

  private async nextInvoiceNo(tenantId: string, issueDate: Date) {
    const yyyy = issueDate.getFullYear();
    const mm = String(issueDate.getMonth() + 1).padStart(2, "0");
    const prefix = `INV-${yyyy}${mm}-`;

    const latest = await this.prisma.invoice.findFirst({
      where: { tenantId, invoiceNo: { startsWith: prefix } },
      orderBy: { invoiceNo: "desc" },
      select: { invoiceNo: true },
    });

    const nextSeq = latest?.invoiceNo
      ? Number(latest.invoiceNo.slice(prefix.length)) + 1
      : 1;

    const seqStr = String(nextSeq).padStart(4, "0");
    return `${prefix}${seqStr}`;
  }

  private async toDtosWithNames(
    invoices: any[],
    fallbackOrderIdsByInvoiceId?: Map<string, string[]>,
  ): Promise<InvoiceDto[]> {
    if (!invoices.length) return [];

    const userIds = new Set<string>();
    for (const inv of invoices) {
      const meta = extractDraftMeta(inv.snapshot);
      if (meta.confirmedByUserId) userIds.add(meta.confirmedByUserId);
      if (inv.issuedByUserId) userIds.add(inv.issuedByUserId);
    }

    const users = userIds.size
      ? await this.prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true, email: true },
        })
      : [];

    const nameById = new Map<string, string>(
      users.map((u) => [u.id, u.name ?? u.email ?? u.id]),
    );

    return invoices.map((inv) =>
      this.toDtoWithNamesSync(
        inv,
        nameById,
        fallbackOrderIdsByInvoiceId?.get(inv.id),
      ),
    );
  }

  private async toDtoWithNames(
    inv: any,
    fallbackOrderIds?: string[],
  ): Promise<InvoiceDto> {
    const [dto] = await this.toDtosWithNames(
      [inv],
      fallbackOrderIds
        ? new Map([[inv.id, fallbackOrderIds]])
        : undefined,
    );
    return dto;
  }

  private toDtoWithNamesSync(
    inv: any,
    nameById: Map<string, string>,
    fallbackOrderIds?: string[],
  ): InvoiceDto {
    const snap = inv.snapshot as any;
    const meta = extractDraftMeta(snap);

    const confirmedByUserId = meta.confirmedByUserId;
    const markedAsSentByUserId = inv.issuedByUserId ?? null;

    const orderIds = inv.orders?.length
      ? inv.orders.map((o: any) => o.id)
      : (fallbackOrderIds ?? meta.orderIds);

    const sourceJobIds = meta.sourceJobIds?.length ? meta.sourceJobIds : [];

    return {
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      customerName: inv.customerName,
      customerCompanyId: (inv as any).customerCompanyId ?? null,
      sourceJobId: (inv as any).sourceJobId ?? null,
      sourceCustomerQuotationId: (inv as any).sourceCustomerQuotationId ?? null,
      paidAt: inv.paidAt ?? null,
      paidByUserId: inv.paidByUserId ?? null,
      issuedAt: inv.issuedAt ?? null,
      issuedByUserId: inv.issuedByUserId ?? null,
      issuedByName: inv.issuedByUserId
        ? (nameById.get(inv.issuedByUserId) ?? null)
        : null,
      templateCode: (inv as any).templateCode ?? "DB_WISDOM",
      currency: inv.currency,
      status: inv.status,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      notes: inv.notes,
      subtotalCents: inv.subtotalCents,
      taxCents: inv.taxCents,
      totalCents: inv.totalCents,
      lineItems: (inv.lineItems ?? []).map((l: any) => ({
        id: l.id,
        description: l.description,
        qty: l.qty,
        unitPriceCents: l.unitPriceCents,
        amountCents: l.amountCents,
        taxCode: l.taxCode,
        taxRate: l.taxRate,
        taxCents: l.taxCents,
        sourceType: l.sourceType ?? null,
        jobChargeId: l.jobChargeId ?? null,
        sourceJobId: (inv as any).sourceJobId ?? null,
        sourceMasterItemId: l.sourceMasterItemId ?? null,
        sourceTripId: l.sourceTripId ?? null,
        tripDisplayRef: l.tripDisplayRefSnapshot ?? null,
        requiresManualAmount: l.requiresManualAmount ?? false,
      })),
      orderIds,
      sourceJobIds,

      confirmedAt: meta.confirmedAt,
      confirmedByUserId: confirmedByUserId,
      confirmedByName: confirmedByUserId
        ? (nameById.get(confirmedByUserId) ?? null)
        : null,

      markedAsSentAt: inv.issuedAt ?? null,
      markedAsSentByUserId: markedAsSentByUserId,
      markedAsSentByName: markedAsSentByUserId
        ? (nameById.get(markedAsSentByUserId) ?? null)
        : null,

      pdfKey: inv.pdfKey ?? null,
      pdfGeneratedAt: inv.pdfGeneratedAt ?? null,
    };
  }

  async getInvoiceDraftFromJobs(
    tenantId: string,
    jobIds: string[],
    user: any,
  ): Promise<{
    customerName: string;
    currency: string;
    sourceJobIds: string[];
    sourceCustomerQuotationId?: string | null;
    suggestedLineItems: Array<{
      description: string;
      qty: number;
      unitPriceCents: number;
      taxCode: string;
      taxRate: number;
      jobChargeId?: string;
      sourceJobId?: string;
      sourceType?: string;
    }>;
  }> {
    this.assertCustomerCanOnlyRead(user);
    if (!jobIds?.length) {
      throw new BadRequestException("jobIds is required");
    }

    const jobs = await this.prisma.job.findMany({
      where: { tenantId, id: { in: jobIds } },
      include: {
        customerCompany: { select: { id: true, name: true } },
        charges: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    });

    if (jobs.length !== jobIds.length) {
      throw new BadRequestException("Some jobs not found under this tenant");
    }

    const companySet = new Set(jobs.map((j) => j.customerCompanyId));
    if (companySet.size !== 1) {
      throw new BadRequestException(
        "All jobs must belong to the same customer company for one invoice draft",
      );
    }
    const quotationIds = uniqueNonEmptyIds(
      jobs.map((j) => j.sourceCustomerQuotationId),
    );
    const hasUnbound = jobs.some((j) => !j.sourceCustomerQuotationId);
    if (quotationIds.length > 1 || (quotationIds.length === 1 && hasUnbound)) {
      throw new BadRequestException(mixedQuotationMessage());
    }

    const company = jobs[0].customerCompany;
    const suggestedLineItems: Array<{
      description: string;
      qty: number;
      unitPriceCents: number;
      taxCode: string;
      taxRate: number;
      jobChargeId?: string;
      sourceJobId?: string;
      sourceType?: string;
    }> = [];

    const jobsNotInvoiceReady = jobs
      .filter(
        (j) =>
          j.status !== JobStatus.READY_FOR_INVOICE &&
          !j.invoiceReadyAt,
      )
      .map((j) => j.internalRef || j.id);
    if (jobsNotInvoiceReady.length > 0) {
      throw new BadRequestException(
        `Selected jobs must be sent to invoice by ops first. Not ready: ${jobsNotInvoiceReady.join(", ")}`,
      );
    }

    const jobsWithoutCharges = jobs
      .filter((j) => !j.charges || j.charges.length === 0)
      .map((j) => j.internalRef || j.id);
    if (jobsWithoutCharges.length > 0) {
      throw new BadRequestException(
        `Selected jobs must have saved JobCharge rows before invoicing. Missing charges for: ${jobsWithoutCharges.join(", ")}`,
      );
    }

    const allChargeIds = jobs.flatMap((j) => (j.charges ?? []).map((c) => c.id));
    const reservedChargeIds = new Set<string>();
    if (allChargeIds.length && this.prisma.invoiceChargeReservation) {
      const reserved = await this.prisma.invoiceChargeReservation.findMany({
        where: { tenantId, jobChargeId: { in: allChargeIds } },
        select: { jobChargeId: true },
      });
      for (const row of reserved) reservedChargeIds.add(row.jobChargeId);
    }

    for (const job of jobs) {
      for (const c of job.charges ?? []) {
        if (reservedChargeIds.has(c.id)) continue;
        const taxCode = c.taxable ? c.taxCode || "SR" : "ZR";
        const taxRate = c.taxRateBasisPoints ?? (c.taxable ? 900 : 0);
        suggestedLineItems.push({
          description: `${job.internalRef} — ${c.label}`,
          qty: c.qty,
          unitPriceCents: c.unitPriceCents,
          taxCode,
          taxRate,
          jobChargeId: c.id,
          sourceJobId: job.id,
          sourceType: "JOB",
        });
      }
    }

    await this.audit.log(
      tenantId,
      "INVOICE_DRAFT_FROM_JOBS",
      "TENANT",
      tenantId,
      { jobIds, lineCount: suggestedLineItems.length },
      user?.userId ?? null,
    );

    return {
      customerName: company?.name ?? jobs[0].receiverName ?? "Customer",
      currency: "SGD",
      sourceJobIds: jobIds,
      sourceCustomerQuotationId: quotationIds[0] ?? null,
      suggestedLineItems,
    };
  }

  async createDraftInvoice(
    tenantId: string,
    dto: CreateInvoiceDto,
    user: any,
  ): Promise<InvoiceDto> {
    this.assertCustomerCanOnlyRead(user);
    const confirmedByUserId: string | null = user?.userId ?? null;
    const orderIds = dto.orderIds ?? [];

    // Draft invoices may be created without any orders/jobs.
    const orders =
      orderIds.length > 0
        ? await this.prisma.transportOrder.findMany({
            where: { tenantId, id: { in: orderIds } },
            select: {
              id: true,
              status: true,
              invoiceId: true,
              customerName: true,
            },
          })
        : [];

    if (orderIds.length > 0 && orders.length !== orderIds.length) {
      throw new BadRequestException("Some orders not found under this tenant");
    }

    if (orders.length > 0) {
      const bad = orders.find(
        (o) =>
          o.invoiceId ||
          ![OrderStatus.Delivered, OrderStatus.Closed].includes(o.status),
      );
      if (bad) {
        throw new BadRequestException(
          "Orders must be Delivered/Closed and not already invoiced",
        );
      }
    }

    await this.validateInvoiceLineSources(
      tenantId,
      dto.customerCompanyId ?? null,
      dto.sourceJobId ?? null,
      dto.lineItems ?? [],
    );

    const normalized = dto.lineItems.map((l) => {
      const unitPriceCents = Number(l.unitPriceCents ?? 0);
      const amountCents = l.qty * unitPriceCents;
      const taxCents =
        l.taxRate > 0 ? Math.round((amountCents * l.taxRate) / 10000) : 0;
      return {
        ...l,
        unitPriceCents,
        amountCents,
        taxCents,
        taxRate: toBasisPoints(l.taxRate),
      };
    });

    const subtotalCents = normalized.reduce((s, l) => s + l.amountCents, 0);
    const taxCents = normalized.reduce((s, l) => s + l.taxCents, 0);
    const totalCents = subtotalCents + taxCents;

    const issueDate = dto.issueDateISO
      ? new Date(dto.issueDateISO + "T00:00:00")
      : new Date();
    const dueDate = dto.dueDateISO
      ? new Date(dto.dueDateISO + "T00:00:00")
      : null;

    const invoiceNo = await this.nextInvoiceNo(tenantId, issueDate);

    const created = await this.prisma.$transaction(async (tx) => {
      const binding = await this.prepareInvoiceChargeBinding(
        tx,
        tenantId,
        dto,
        normalized,
      );
      const inv = await tx.invoice.create({
        data: {
          tenantId,
          invoiceNo,
          customerName: dto.customerName,
          customerCompanyId: dto.customerCompanyId ?? null,
          sourceJobId: dto.sourceJobId ?? binding.sourceJobIds[0] ?? null,
          sourceCustomerQuotationId: binding.boundQuotationId,
          templateCode: dto.templateCode ?? "DB_WISDOM",
          currency: dto.currency ?? "SGD",
          issueDate,
          dueDate,
          notes: dto.notes ?? null,
          status: INVOICE_STATUS.DRAFT,
          subtotalCents,
          taxCents,
          totalCents,
          lineItems: {
            create: normalized.map((l) => this.invoiceLineCreateData(tenantId, l)),
          },
          snapshot: {
            stage: INVOICE_STATUS.DRAFT,
            orderIds,
            sourceJobIds: binding.sourceJobIds,
            sourceCustomerQuotationId: binding.boundQuotationId,
            confirmedAt: new Date().toISOString(),
            confirmedByUserId: confirmedByUserId ?? null,
          },
        },
        include: {
          lineItems: true,
          orders: { select: { id: true } },
        },
      });
      await this.syncInvoiceChargeReservations(
        tx,
        tenantId,
        inv.id,
        binding.jobChargeIds,
      );
      await this.syncJobsAfterChargeReservationChange(
        tx,
        tenantId,
        binding.sourceJobIds,
      );
      return inv;
    });
    await this.audit.log(
      tenantId,
      "INVOICE_CREATED",
      "INVOICE",
      created.id,
      {
        invoiceNo: created.invoiceNo,
        sourceJobIds: resolveInvoiceSourceJobIds({
          sourceJobId: created.sourceJobId,
          snapshot: created.snapshot,
        }),
        jobChargeIds: uniqueNonEmptyIds(
          (created.lineItems ?? []).map((l: any) => l.jobChargeId),
        ),
        sourceCustomerQuotationId:
          (created as any).sourceCustomerQuotationId ?? null,
      },
      user?.userId ?? null,
    );

    // Return orderIds from dto since orders aren't linked yet.
    // PDF: generated on the client and uploaded via POST .../pdf.
    return this.toDtoWithNames(created, orderIds);
  }

  async issueInvoice(tenantId: string, invoiceId: string, user: any) {
    this.assertCustomerCanOnlyRead(user);
    const issuedByUserId: string | null = user?.userId ?? null;
    const issuedAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { tenantId, id: invoiceId },
        include: { lineItems: true },
      });

      if (!inv) throw new BadRequestException("Invoice not found");
      if (isInvoiceIssued(inv.status)) {
        return { invoice: inv, idempotent: true };
      }
      if (!canIssueInvoice(inv.status)) {
        throw new BadRequestException(invoiceMustGenerateBeforeIssueMessage());
      }
      assertGeneratedFrozenArtifact(inv);

      const rawOrderIds = (inv.snapshot as any)?.orderIds;
      const orderIds: string[] = Array.isArray(rawOrderIds)
        ? rawOrderIds
        : [];

      let orders: Array<{
        id: string;
        orderRef: string;
        internalRef: string | null;
        priceCents: number | null;
      }> = [];

      if (orderIds.length > 0) {
        const found = await tx.transportOrder.findMany({
          where: { tenantId, id: { in: orderIds } },
          select: {
            id: true,
            status: true,
            invoiceId: true,
            orderRef: true,
            internalRef: true,
            priceCents: true,
          },
        });

        if (found.length !== orderIds.length) {
          throw new BadRequestException("Some orders no longer exist");
        }

        const bad = found.find(
          (o) => o.invoiceId || o.status !== OrderStatus.Delivered,
        );
        if (bad) {
          throw new BadRequestException(
            "Some orders are no longer eligible to invoice",
          );
        }

        const updated = await tx.transportOrder.updateMany({
          where: { tenantId, id: { in: orderIds }, invoiceId: null },
          data: { invoiceId: inv.id, status: OrderStatus.Closed },
        });

        if (updated.count !== orderIds.length) {
          throw new BadRequestException(
            "Some orders were invoiced by someone else",
          );
        }

        orders = found;
      }

      const sourceJobIds = resolveInvoiceSourceJobIds({
        sourceJobId: (inv as any).sourceJobId,
        snapshot: inv.snapshot,
      });
      const jobChargeIds = uniqueNonEmptyIds(
        (inv.lineItems ?? []).map((l: any) => l.jobChargeId),
      );
      await this.assertJobChargesFreeForInvoice(
        tx,
        tenantId,
        jobChargeIds,
        inv.id,
      );
      await this.syncInvoiceChargeReservations(
        tx,
        tenantId,
        inv.id,
        jobChargeIds,
      );

      const finalSnapshot = {
        stage: INVOICE_STATUS.ISSUED,
        orderIds,
        sourceJobIds,
        invoice: {
          id: inv.id,
          invoiceNo: inv.invoiceNo,
          customerName: inv.customerName,
          currency: inv.currency,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          notes: inv.notes,
          subtotalCents: inv.subtotalCents,
          taxCents: inv.taxCents,
          totalCents: inv.totalCents,
        },
        orders: orders.map((o) => ({
          id: o.id,
          orderRef: o.orderRef,
          internalRef: o.internalRef,
          priceCents: o.priceCents,
        })),
        lineItems: inv.lineItems,
      };

      const locked = await tx.invoice.update({
        where: { id: inv.id },
        data: {
          status: INVOICE_STATUS.ISSUED,
          issuedAt,
          issuedByUserId: issuedByUserId ?? null,
          lockedAt: issuedAt,
          snapshot: finalSnapshot,
        },
        include: { lineItems: true, orders: { select: { id: true } } },
      });
      await this.syncJobsAfterChargeReservationChange(tx, tenantId, sourceJobIds);

      return { invoice: locked, idempotent: false };
    });

    if (!result.idempotent) {
      await this.audit.log(
        tenantId,
        "INVOICE_ISSUED",
        "INVOICE",
        invoiceId,
        {
          invoiceNo: result.invoice.invoiceNo,
          previousStatus: INVOICE_STATUS.GENERATED,
          status: INVOICE_STATUS.ISSUED,
        },
        user?.userId ?? null,
      );
    }

    return this.toDtoWithNames(result.invoice);
  }

  async voidInvoice(tenantId: string, invoiceId: string, user: any) {
    this.assertCustomerCanOnlyRead(user);
    const updated = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { tenantId, id: invoiceId },
        include: { lineItems: true },
      });
      if (!inv) throw new BadRequestException("Invoice not found");
      if (isInvoiceVoid(inv.status)) {
        return { voided: inv, previousStatus: inv.status, idempotent: true };
      }
      if (isInvoicePaid(inv.status)) {
        throw new BadRequestException(paidInvoicesCannotBeVoidedMessage());
      }
      if (!canVoidInvoice(inv.status)) {
        throw new BadRequestException("Only DRAFT, GENERATED, or ISSUED invoices can be voided");
      }
      const previousStatus = inv.status;
      const jobIds = resolveInvoiceSourceJobIds({
        sourceJobId: (inv as any).sourceJobId,
        snapshot: inv.snapshot,
        sourceJobIds: uniqueNonEmptyIds(
          (inv.lineItems ?? []).map((l: any) => l.sourceJobId),
        ),
      });
      await this.releaseInvoiceChargeReservations(tx, tenantId, inv.id);
      const voided = await tx.invoice.update({
        where: { id: inv.id },
        data: {
          status: INVOICE_STATUS.VOID,
          lockedAt: new Date(),
          snapshot: {
            ...((inv.snapshot as any) ?? {}),
            stage: INVOICE_STATUS.VOID,
            voidedAt: new Date().toISOString(),
            voidedByUserId: user?.userId ?? null,
          },
        },
        include: { lineItems: true, orders: { select: { id: true } } },
      });
      await this.syncJobsAfterChargeReservationChange(tx, tenantId, jobIds);
      return { voided, previousStatus, idempotent: false };
    });
    if (!updated.idempotent) {
      await this.audit.log(
        tenantId,
        "INVOICE_VOIDED",
        "INVOICE",
        invoiceId,
        {
          invoiceNo: updated.voided.invoiceNo,
          previousStatus: updated.previousStatus,
          status: INVOICE_STATUS.VOID,
        },
        user?.userId ?? null,
      );
    }
    return this.toDtoWithNames(updated.voided);
  }

  async markInvoicePaid(tenantId: string, invoiceId: string, user: any) {
    this.assertCustomerCanOnlyRead(user);
    if (
      hasRole(user?.roles ?? user?.role, CanonicalTenantRole.TRANSPORT_ADMIN) &&
      !hasRole(user?.roles ?? user?.role, CanonicalTenantRole.TENANT_ADMIN) &&
      !hasRole(user?.roles ?? user?.role, CanonicalTenantRole.FINANCE_ADMIN)
    ) {
      throw new ForbiddenException("Only Admin or Finance can mark invoices Paid");
    }
    const paidAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { tenantId, id: invoiceId },
        include: { lineItems: true },
      });
      if (!inv) throw new BadRequestException("Invoice not found");
      if (isInvoicePaid(inv.status)) {
        return { paid: inv, previousStatus: inv.status, idempotent: true };
      }
      if (!canMarkInvoicePaid(inv.status)) {
        throw new BadRequestException(invoiceMustIssueBeforePaidMessage());
      }
      const previousStatus = inv.status;
      const paid = await tx.invoice.update({
        where: { id: inv.id },
        data: {
          status: INVOICE_STATUS.PAID,
          paidAt,
          paidByUserId: user?.userId ?? null,
          snapshot: {
            ...((inv.snapshot as any) ?? {}),
            stage: INVOICE_STATUS.PAID,
            paidAt: paidAt.toISOString(),
            paidByUserId: user?.userId ?? null,
          },
        },
        include: { lineItems: true, orders: { select: { id: true } } },
      });
      return { paid, previousStatus, idempotent: false };
    });
    if (!updated.idempotent) {
      await this.audit.log(
        tenantId,
        "INVOICE_PAID",
        "INVOICE",
        invoiceId,
        {
          invoiceNo: updated.paid.invoiceNo,
          previousStatus: updated.previousStatus,
          status: INVOICE_STATUS.PAID,
          paidAt: paidAt.toISOString(),
          actorUserId: user?.userId ?? null,
        },
        user?.userId ?? null,
      );
    }
    return this.toDtoWithNames(updated.paid);
  }

  // Update an existing Draft invoice: replaces line items; snapshot orderIds are
  // optional (omit dto.orderIds to keep existing; send [] to clear).
  // GENERATED/ISSUED/PAID/VOID invoices are not editable and cannot revert to DRAFT.
  async updateDraftInvoice(
    tenantId: string,
    invoiceId: string,
    dto: CreateInvoiceDto,
    user: any,
  ): Promise<InvoiceDto> {
    this.assertCustomerCanOnlyRead(user);
    const updatedByUserId: string | null = user?.userId ?? null;
    const inv = await this.prisma.invoice.findFirst({
      where: { tenantId, id: invoiceId },
      include: { lineItems: true, orders: { select: { id: true } } },
    });

    if (!inv) throw new BadRequestException("Invoice not found");
    if (!isInvoiceEditable(inv.status)) {
      throw new BadRequestException("Only DRAFT invoices can be updated");
    }

    const prevSnapEarly = inv.snapshot as any;
    const existingOrderIds = Array.isArray(prevSnapEarly?.orderIds)
      ? (prevSnapEarly.orderIds as string[])
      : [];
    const existingSourceJobIds = Array.isArray(prevSnapEarly?.sourceJobIds)
      ? (prevSnapEarly.sourceJobIds as string[])
      : [];
    // Optional: omit orderIds on PATCH to keep current snapshot; send [] to clear.
    const orderIds =
      dto.orderIds !== undefined ? (dto.orderIds ?? []) : existingOrderIds;
    const sourceJobIds =
      dto.sourceJobIds !== undefined
        ? (dto.sourceJobIds ?? [])
        : existingSourceJobIds;

    // Validate orders before opening the transaction.
    const orders =
      orderIds.length > 0
        ? await this.prisma.transportOrder.findMany({
            where: { tenantId, id: { in: orderIds } },
            select: { id: true, status: true, invoiceId: true },
          })
        : [];

    if (orderIds.length > 0 && orders.length !== orderIds.length) {
      throw new BadRequestException(
        "Some orders not found under this tenant",
      );
    }

    if (orders.length > 0) {
      const bad = orders.find(
        (o) =>
          o.invoiceId ||
          ![OrderStatus.Delivered, OrderStatus.Closed].includes(o.status as any),
      );
      if (bad) {
        throw new BadRequestException(
          "Orders must be Delivered/Closed and not already invoiced",
        );
      }
    }

    const sourceJobId = dto.sourceJobId ?? (inv as any).sourceJobId ?? null;
    const customerCompanyId =
      dto.customerCompanyId ?? (inv as any).customerCompanyId ?? null;
    const draftLineItems = dto.lineItems ?? [];
    const normalizedSourceJobIds = (sourceJobIds ?? [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean);
    if (normalizedSourceJobIds.length !== (sourceJobIds ?? []).length) {
      throw new BadRequestException("sourceJobIds cannot contain empty values");
    }
    const uniqueSourceJobIds = Array.from(new Set(normalizedSourceJobIds));
    if (uniqueSourceJobIds.length > 0) {
      const foundJobs = await this.prisma.job.findMany({
        where: {
          tenantId,
          id: { in: uniqueSourceJobIds },
        },
        select: { id: true },
      });
      if (foundJobs.length !== uniqueSourceJobIds.length) {
        throw new BadRequestException("Some sourceJobIds not found under this tenant");
      }
    }

    await this.validateInvoiceLineSources(
      tenantId,
      customerCompanyId,
      sourceJobId,
      draftLineItems,
    );

    // Compute totals from manual line items before opening the transaction.
    const normalized = draftLineItems.map((l) => {
      const unitPriceCents = Number(l.unitPriceCents ?? 0);
      const amountCents = l.qty * unitPriceCents;
      const taxCents =
        l.taxRate > 0 ? Math.round((amountCents * l.taxRate) / 10000) : 0;
      return {
        ...l,
        unitPriceCents,
        amountCents,
        taxCents,
        taxRate: toBasisPoints(l.taxRate),
      };
    });

    const subtotalCents = normalized.reduce((s, l) => s + l.amountCents, 0);
    const taxCents = normalized.reduce((s, l) => s + l.taxCents, 0);
    const totalCents = subtotalCents + taxCents;

    const issueDate = dto.issueDateISO
      ? new Date(dto.issueDateISO + "T00:00:00")
      : inv.issueDate;

    const dueDate = dto.dueDateISO
      ? new Date(dto.dueDateISO + "T00:00:00")
      : null;

    const prevSnap = inv.snapshot as any;
    const draftMeta = extractDraftMeta(prevSnap);

    const nextSnapshot = {
      ...(prevSnap ?? {}),
      stage: INVOICE_STATUS.DRAFT,
      orderIds,
      sourceJobIds: normalizedSourceJobIds,
      confirmedAt:
        draftMeta.confirmedAt?.toISOString() ?? prevSnap?.confirmedAt ?? null,
      confirmedByUserId:
        draftMeta.confirmedByUserId ?? prevSnap?.confirmedByUserId ?? null,
      updatedAt: new Date().toISOString(),
      updatedByUserId: updatedByUserId ?? null,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const binding = await this.prepareInvoiceChargeBinding(
        tx,
        tenantId,
        {
          ...dto,
          customerCompanyId,
          sourceJobId,
          sourceJobIds: uniqueSourceJobIds,
        },
        normalized,
        inv.id,
      );
      const snapshot = {
        ...nextSnapshot,
        sourceJobIds: binding.sourceJobIds.length
          ? binding.sourceJobIds
          : normalizedSourceJobIds,
        sourceCustomerQuotationId: binding.boundQuotationId,
      };
      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          customerName: dto.customerName,
          customerCompanyId,
          sourceJobId: sourceJobId ?? binding.sourceJobIds[0] ?? null,
          sourceCustomerQuotationId: binding.boundQuotationId,
          templateCode: dto.templateCode ?? (inv as any).templateCode ?? "DB_WISDOM",
          currency: dto.currency ?? inv.currency,
          issueDate,
          dueDate,
          notes: dto.notes ?? null,
          subtotalCents,
          taxCents,
          totalCents,
          snapshot,
        },
      });

      await tx.invoiceLineItem.deleteMany({
        where: { tenantId, invoiceId: inv.id },
      });

      if (normalized.length > 0) {
        await tx.invoiceLineItem.createMany({
          data: normalized.map((l) => ({
            ...this.invoiceLineCreateData(tenantId, l),
            invoiceId: inv.id,
          })),
        });
      }

      await this.syncInvoiceChargeReservations(
        tx,
        tenantId,
        inv.id,
        binding.jobChargeIds,
      );
      await this.syncJobsAfterChargeReservationChange(
        tx,
        tenantId,
        uniqueNonEmptyIds([...binding.sourceJobIds, ...normalizedSourceJobIds]),
      );

      return tx.invoice.findFirst({
        where: { id: inv.id, tenantId },
        include: { lineItems: true, orders: { select: { id: true } } },
      });
    });
    if (!updated) throw new BadRequestException("Failed to update draft invoice");

    // Draft has no linked orders; return with snapshot orderIds.
    // PDF: regenerated on the client after edits; upload via POST .../pdf.
    const snap = updated.snapshot as any;
    const snapshotOrderIds = Array.isArray(snap?.orderIds) ? snap.orderIds : [];
    rt.publishInvoiceEvent(this.realtime, "invoice.updated", tenantId, invoiceId, {
      jobId: (updated as any).sourceJobId ?? dto.sourceJobId ?? null,
    });
    return this.toDtoWithNames(updated, snapshotOrderIds);
  }

  private async buildInvoiceRenderData(tenantId: string, inv: any) {
    const company = (inv as any).customerCompanyId
      ? await this.prisma.customer_companies.findFirst({
        where: {
          id: (inv as any).customerCompanyId,
          tenantId,
        },
      })
      : null;
    const sourceJob = (inv as any).sourceJobId
      ? await this.prisma.job.findFirst({
        where: { id: (inv as any).sourceJobId, tenantId },
        select: { id: true, internalRef: true, externalRef: true },
      })
      : null;
    const taxRate = inv.lineItems?.[0]?.taxRate ?? 900;
    const currency = inv.currency ?? "SGD";
    const billingAddress = company?.billingSameAsAddress
      ? [company?.addressLine1, company?.addressLine2, company?.postalCode, company?.country]
      : [company?.billingAddressLine1, company?.billingAddressLine2, company?.billingPostalCode, company?.billingCountry];
    const reference = sourceJob?.internalRef
      ? `${sourceJob.internalRef}${sourceJob.externalRef ? ` // ${sourceJob.externalRef}` : ""}`
      : null;
    const templateCode = String((inv as any).templateCode ?? "").trim().toUpperCase();
    const resolvedTemplateCode =
      templateCode === "WISDOM_FORCE" ||
      ((inv as any).sourceJobId && (inv as any).customerCompanyId)
        ? "WISDOM_FORCE"
        : "DB_WISDOM";
    return {
      invoiceNo: inv.invoiceNo,
      templateCode: resolvedTemplateCode,
      sellerName: "Wisdom Force Logistics Pte Ltd",
      sellerUen: "202606497W",
      sellerAddress: "Singapore",
      customerName: inv.customerName,
      customerBillingAddress: billingAddress.filter(Boolean).join(", "),
      issueDateISO: this.toIsoDateOnly(inv.issueDate),
      dueDateISO: inv.dueDate ? this.toIsoDateOnly(inv.dueDate) : null,
      reference,
      currency,
      taxRatePercent: taxRate / 100,
      lines: (inv.lineItems ?? []).map((li: any) => ({
        description: li.description,
        qty: li.qty,
        unitPriceCents: li.unitPriceCents,
        amountCents: li.amountCents,
        taxLabel: li.taxRate > 0 ? `${(li.taxRate / 100).toFixed(2)}%` : "0%",
      })),
      subtotalCents: inv.subtotalCents,
      taxCents: inv.taxCents,
      totalCents: inv.totalCents,
      amountPaidCents: 0,
      amountDueCents: inv.totalCents,
      paymentInstructions: inv.notes ?? null,
      sourceJobInternalRef: sourceJob?.internalRef ?? null,
      sourceJobId: sourceJob?.id ?? null,
      customerCompanyId: company?.id ?? null,
    };
  }

  private async createInvoicePdfBuffer(renderData: any): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const logoBytes = loadInvoiceAssetBuffer("WF-logo.jpeg");
    const qrBytes =
      loadInvoiceAssetBuffer("WF-QR.png") ?? loadInvoiceAssetBuffer("WF-QR.jpeg");
    const marginX = 42;
    const pageWidth = 595.28;
    const contentRight = pageWidth - marginX;

    const tryEmbedImage = async (bytes: Buffer) => {
      try {
        return await pdfDoc.embedJpg(bytes);
      } catch {
        try {
          return await pdfDoc.embedPng(bytes);
        } catch {
          return null;
        }
      }
    };

    let y = 804;
    if (logoBytes) {
      const logo = await tryEmbedImage(logoBytes);
      if (logo) {
        const w = 170;
        const h = (logo.height / logo.width) * w;
        page.drawImage(logo, { x: marginX, y: y - h + 8, width: w, height: h });
      } else {
        console.warn("[invoices] Failed to embed WF-logo asset in PDF");
      }
    } else {
      page.drawText("WISDOM FORCE LOGISTICS PTE LTD", { x: marginX, y: y - 10, size: 11, font: bold });
    }

    page.drawText("TAX INVOICE", { x: 382, y: 802, size: 18, font: bold });
    page.drawText(`Invoice No: ${renderData.invoiceNo}`, { x: 382, y: 782, size: 10, font });
    page.drawText(`Invoice Date: ${renderData.issueDateISO}`, { x: 382, y: 768, size: 10, font });
    page.drawText(`Due Date: ${renderData.dueDateISO ?? "-"}`, { x: 382, y: 754, size: 10, font });
    page.drawText(`Reference: ${renderData.reference ?? "-"}`, { x: 382, y: 740, size: 10, font });

    y = 714;
    page.drawText("Bill To", { x: marginX, y, size: 11, font: bold });
    y -= 14;
    page.drawText(String(renderData.customerName ?? ""), { x: marginX, y, size: 10, font: bold });
    y -= 13;
    page.drawText(String(renderData.customerBillingAddress ?? ""), { x: marginX, y, size: 10, font });

    y = 656;
    page.drawText("Description", { x: marginX, y, size: 10, font: bold });
    page.drawText("Qty", { x: 352, y, size: 10, font: bold });
    page.drawText("Unit Price", { x: 390, y, size: 10, font: bold });
    page.drawText("Tax", { x: 470, y, size: 10, font: bold });
    page.drawText("Amount", { x: 520, y, size: 10, font: bold });
    y -= 8;
    page.drawLine({ start: { x: marginX, y }, end: { x: contentRight, y }, thickness: 0.8 });

    const wrapLine = (text: string, maxWidth: number): string[] => {
      const wrapped: string[] = [];
      for (const paragraph of String(text ?? "").split("\n")) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        if (words.length === 0) {
          wrapped.push("");
          continue;
        }
        let current = "";
        for (const word of words) {
          const candidate = current ? `${current} ${word}` : word;
          if (font.widthOfTextAtSize(candidate, 9.2) <= maxWidth) {
            current = candidate;
          } else {
            if (current) wrapped.push(current);
            if (font.widthOfTextAtSize(word, 9.2) <= maxWidth) {
              current = word;
            } else {
              let chunk = "";
              for (const ch of word) {
                const next = chunk + ch;
                if (font.widthOfTextAtSize(next, 9.2) <= maxWidth) {
                  chunk = next;
                } else {
                  if (chunk) wrapped.push(chunk);
                  chunk = ch;
                }
              }
              current = chunk;
            }
          }
        }
        if (current) wrapped.push(current);
      }
      return wrapped.length > 0 ? wrapped : [""];
    };

    for (const line of renderData.lines.slice(0, 16)) {
      const wrappedDescription = wrapLine(String(line.description ?? ""), 300);
      const rowHeight = Math.max(14, wrappedDescription.length * 11 + 4);
      y -= rowHeight;
      if (y < 120) break;
      const amount = (Number(line.amountCents || 0) / 100).toFixed(2);
      const unit = (Number(line.unitPriceCents || 0) / 100).toFixed(2);
      wrappedDescription.forEach((descLine, idx) => {
        page.drawText(descLine, { x: marginX, y: y + rowHeight - 12 - idx * 11, size: 9.2, font });
      });
      page.drawText(String(line.qty), { x: 355, y: y + rowHeight - 12, size: 9.5, font });
      page.drawText(unit, { x: 396, y: y + rowHeight - 12, size: 9.5, font });
      page.drawText(String(line.taxLabel ?? ""), { x: 472, y: y + rowHeight - 12, size: 9.5, font });
      page.drawText(amount, { x: 520, y: y + rowHeight - 12, size: 9.5, font });
    }
    y -= 12;
    page.drawLine({ start: { x: 338, y }, end: { x: contentRight, y }, thickness: 0.8 });
    y -= 14;
    const subtotal = (Number(renderData.subtotalCents || 0) / 100).toFixed(2);
    const gst = (Number(renderData.taxCents || 0) / 100).toFixed(2);
    const total = (Number(renderData.totalCents || 0) / 100).toFixed(2);
    const due = (Number(renderData.amountDueCents || 0) / 100).toFixed(2);
    page.drawText("Subtotal", { x: 370, y, size: 10, font });
    page.drawText(`SGD ${subtotal}`, { x: 500, y, size: 10, font });
    y -= 13;
    page.drawText(`GST ${renderData.taxRatePercent}%`, { x: 370, y, size: 10, font });
    page.drawText(`SGD ${gst}`, { x: 500, y, size: 10, font });
    y -= 13;
    page.drawText("Invoice Total", { x: 370, y, size: 10.5, font: bold });
    page.drawText(`SGD ${total}`, { x: 500, y, size: 10.5, font: bold });
    y -= 13;
    page.drawText("Total Net Payments", { x: 370, y, size: 10, font });
    page.drawText("SGD 0.00", { x: 500, y, size: 10, font });
    y -= 14;
    page.drawText("Amount Due", { x: 370, y, size: 11, font: bold });
    page.drawText(`SGD ${due}`, { x: 500, y, size: 11, font: bold });

    const page2 = pdfDoc.addPage([595.28, 841.89]);
    page2.drawText("Payment Details", { x: marginX, y: 790, size: 16, font: bold });
    page2.drawText(String(renderData.paymentInstructions ?? "Bank transfer / PayNow supported."), {
      x: marginX,
      y: 756,
      size: 11,
      font,
    });
    page2.drawText("PayNow / SGQR", { x: marginX, y: 724, size: 12, font: bold });
    page2.drawText("Scan to Pay", { x: marginX, y: 706, size: 11, font });
    page2.drawText(`UEN: ${renderData.sellerUen ?? "202606497W"}`, { x: marginX, y: 690, size: 11, font });
    if (qrBytes) {
      const qr = await tryEmbedImage(qrBytes);
      if (qr) {
        const w = 190;
        const h = (qr.height / qr.width) * w;
        page2.drawImage(qr, { x: 360, y: 735 - h, width: w, height: h });
        page2.drawRectangle({
          x: 356,
          y: 731 - h,
          width: w + 8,
          height: h + 8,
          borderWidth: 1,
        });
      } else {
        console.warn("[invoices] Failed to embed WF-QR asset in PDF");
        page2.drawText("QR unavailable", { x: 365, y: 700, size: 10, font });
      }
    } else {
      page2.drawText("QR unavailable", { x: 365, y: 700, size: 10, font });
    }
    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }

  async getInvoicePreview(tenantId: string, invoiceId: string, user: any) {
    const inv = await this.prisma.invoice.findFirst({
      where: { tenantId, id: invoiceId },
      include: { lineItems: true, orders: { select: { id: true, customerCompanyId: true } } },
    });
    if (!inv) throw new BadRequestException("Invoice not found");
    await this.assertCanAccessInvoice(tenantId, inv, user);
    const renderData = await this.buildInvoiceRenderData(tenantId, inv);
    const html = renderInvoiceHtml(renderData as any);
    return { invoiceId: inv.id, templateCode: (inv as any).templateCode ?? "DB_WISDOM", html, renderData };
  }

  private buildInvoicePdfFileName(
    sourceJobInternalRef: string | null | undefined,
    fallbackInvoiceNo: string | null | undefined,
    invoiceId: string,
  ): string {
    const safeRef = this.safeFileName(
      sourceJobInternalRef || fallbackInvoiceNo || invoiceId,
    );
    return `${safeRef}-INVOICE.pdf`;
  }

  private buildInvoicePdfStorageKey(
    tenantId: string,
    invoiceId: string,
    fileName: string,
  ): string {
    return `${tenantId}/invoices/${invoiceId}/${fileName}`;
  }

  private toInvoicePdfUploadError(error: { message?: string } | null | undefined) {
    const message = String(error?.message ?? "");
    if (
      message.toLowerCase().includes("bucket") &&
      message.toLowerCase().includes("not found")
    ) {
      return new BadRequestException(
        "Storage bucket 'invoice-documents' does not exist. Create it in Supabase Storage.",
      );
    }
    return new BadRequestException(`Failed to upload invoice PDF: ${message || "unknown error"}`);
  }

  private async persistInvoicePdfSnapshot(params: {
    tenantId: string;
    invoice: any;
    customerCompanyId: string;
    sourceJobId: string | null;
    sourceJobInternalRef: string | null;
    actorUserId: string | null;
    pdfBuffer: Buffer;
  }): Promise<{ updatedInvoice: any; document: any }> {
    const {
      tenantId,
      invoice,
      customerCompanyId,
      sourceJobId,
      sourceJobInternalRef,
      actorUserId,
      pdfBuffer,
    } = params;
    if (!isInvoiceDraft(invoice.status)) {
      throw new BadRequestException(
        invoiceCannotGenerateFromStatusMessage(invoice.status),
      );
    }
    const fileName = this.buildInvoicePdfFileName(
      sourceJobInternalRef,
      invoice.invoiceNo,
      invoice.id,
    );
    const storageKey = this.buildInvoicePdfStorageKey(tenantId, invoice.id, fileName);
    const supabase = this.supabaseService.getClient();
    const { error: uploadError } = await supabase.storage
      .from(INVOICE_DOCUMENTS_BUCKET)
      .upload(storageKey, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadError) {
      throw this.toInvoicePdfUploadError(uploadError);
    }

    const generatedAt = new Date();
    const obsoleteStorageKeys = new Set<string>();

    try {
      const { updatedInvoice, document } = await this.prisma.$transaction(async (tx) => {
        const existingDocuments = await tx.customerCompanyDocument.findMany({
          where: {
            tenantId,
            sourceInvoiceId: invoice.id,
            type: { in: ["INVOICE", "COMPANY_INVOICE"] },
          },
          orderBy: [{ createdAt: "desc" }],
          select: { id: true, storageKey: true, status: true },
        });

        existingDocuments.forEach((row: any) => {
          if (row.storageKey && row.storageKey !== storageKey) {
            obsoleteStorageKeys.add(row.storageKey);
          }
        });
        if (invoice.pdfKey && invoice.pdfKey !== storageKey) {
          obsoleteStorageKeys.add(invoice.pdfKey);
        }

        const primaryDocument = existingDocuments[0] ?? null;
        const document = primaryDocument
          ? await tx.customerCompanyDocument.update({
              where: { id: primaryDocument.id },
              data: {
                customerCompanyId,
                type: "INVOICE",
                fileName,
                fileUrl: storageKey,
                storageKey,
                mimeType: "application/pdf",
                fileSizeBytes: pdfBuffer.length,
                uploadedByUserId: actorUserId ?? null,
                generatedByUserId: actorUserId ?? null,
                generatedAt,
                sourceJobId,
                sourceInvoiceId: invoice.id,
                status: "ACTIVE",
                deletedAt: null,
              },
              include: { generatedBy: { select: { name: true, email: true } } },
            })
          : await tx.customerCompanyDocument.create({
              data: {
                tenantId,
                customerCompanyId,
                type: "INVOICE",
                fileName,
                fileUrl: storageKey,
                storageKey,
                mimeType: "application/pdf",
                fileSizeBytes: pdfBuffer.length,
                uploadedByUserId: actorUserId ?? null,
                generatedByUserId: actorUserId ?? null,
                generatedAt,
                sourceJobId,
                sourceInvoiceId: invoice.id,
                status: "ACTIVE",
              },
              include: { generatedBy: { select: { name: true, email: true } } },
            });

        const supersededDocumentIds = existingDocuments
          .map((row: any) => row.id)
          .filter((id: string) => id !== document.id);
        if (supersededDocumentIds.length > 0) {
          await tx.customerCompanyDocument.updateMany({
            where: { id: { in: supersededDocumentIds } },
            data: {
              status: "DELETED",
              deletedAt: generatedAt,
            },
          });
        }

        const updatedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            pdfKey: storageKey,
            pdfGeneratedAt: generatedAt,
            ...(isInvoiceDraft(invoice.status)
              ? {
                  status: INVOICE_STATUS.GENERATED,
                  lockedAt: generatedAt,
                  snapshot: {
                    ...((invoice.snapshot as any) ?? {}),
                    stage: INVOICE_STATUS.GENERATED,
                    generatedAt: generatedAt.toISOString(),
                    generatedByUserId: actorUserId ?? null,
                  },
                }
              : {}),
          },
          include: {
            lineItems: true,
            orders: { select: { id: true, customerCompanyId: true } },
          },
        });

        return { updatedInvoice, document };
      });

      const keysToDelete = Array.from(obsoleteStorageKeys);
      if (keysToDelete.length > 0) {
        await supabase.storage.from(INVOICE_DOCUMENTS_BUCKET).remove(keysToDelete);
      }

      return { updatedInvoice, document };
    } catch (error) {
      await supabase.storage.from(INVOICE_DOCUMENTS_BUCKET).remove([storageKey]);
      throw error;
    }
  }

  async generateInvoicePdf(tenantId: string, invoiceId: string, user: any) {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;
    const inv = await this.prisma.invoice.findFirst({
      where: { tenantId, id: invoiceId },
      include: { lineItems: true, orders: { select: { id: true, customerCompanyId: true } } },
    });
    if (!inv) throw new BadRequestException("Invoice not found");
    await this.assertCanAccessInvoice(tenantId, inv, user);
    if (isInvoiceIssued(inv.status) || isInvoicePaid(inv.status) || isInvoiceVoid(inv.status)) {
      throw new BadRequestException(invoiceCannotGenerateFromStatusMessage(inv.status));
    }
    if (isInvoiceGenerated(inv.status)) {
      const existingDocument = await this.prisma.customerCompanyDocument.findFirst({
        where: {
          tenantId,
          sourceInvoiceId: inv.id,
          type: { in: ["INVOICE", "COMPANY_INVOICE"] },
          status: "ACTIVE",
        },
        include: { generatedBy: { select: { name: true, email: true } } },
        orderBy: { createdAt: "desc" },
      });
      assertGeneratedFrozenArtifact({
        ...inv,
        documentStorageKey: existingDocument?.storageKey ?? null,
      });
      const dto = await this.toDtoWithNames(inv);
      return {
        ...dto,
        invoiceId: inv.id,
        document: existingDocument
          ? {
              id: existingDocument.id,
              customerCompanyId: existingDocument.customerCompanyId,
              sourceJobId: existingDocument.sourceJobId,
              invoiceId: existingDocument.sourceInvoiceId,
              documentType: existingDocument.type,
              fileName: existingDocument.fileName,
              mimeType: existingDocument.mimeType,
              storageKey: existingDocument.storageKey,
              generatedByUserId: existingDocument.generatedByUserId,
              generatedByName:
                existingDocument.generatedBy?.name ??
                existingDocument.generatedBy?.email ??
                null,
              generatedAt: existingDocument.generatedAt,
              createdAt: existingDocument.createdAt,
            }
          : null,
      };
    }
    if (!isInvoiceDraft(inv.status)) {
      throw new BadRequestException(invoiceCannotGenerateFromStatusMessage(inv.status));
    }
    const missing = (inv.lineItems ?? []).find((li: any) =>
      li.requiresManualAmount && (!li.unitPriceCents || li.unitPriceCents <= 0));
    if (missing) throw new BadRequestException("Missing manual invoice amount");

    const renderData = await this.buildInvoiceRenderData(tenantId, inv);
    if (!renderData.customerCompanyId) {
      throw new BadRequestException(
        "Invoice must have a customerCompanyId before generating a PDF",
      );
    }
    const pdfBuffer = await this.createInvoicePdfBuffer(renderData);
    const { updatedInvoice, document } = await this.persistInvoicePdfSnapshot({
      tenantId,
      invoice: inv,
      customerCompanyId: renderData.customerCompanyId,
      sourceJobId: renderData.sourceJobId,
      sourceJobInternalRef: renderData.sourceJobInternalRef,
      actorUserId,
      pdfBuffer,
    });

    rt.publishInvoiceEvent(this.realtime, "invoice.generated", tenantId, inv.id, {
      jobId: renderData.sourceJobId ?? null,
    });

    if (isInvoiceDraft(inv.status) && isInvoiceGenerated(updatedInvoice.status)) {
      await this.audit.log(
        tenantId,
        "INVOICE_GENERATED",
        "INVOICE",
        inv.id,
        {
          invoiceNo: updatedInvoice.invoiceNo,
          previousStatus: INVOICE_STATUS.DRAFT,
          status: INVOICE_STATUS.GENERATED,
        },
        actorUserId,
      );
    }

    const dto = await this.toDtoWithNames(updatedInvoice);
    return {
      ...dto,
      invoiceId: inv.id,
      status: updatedInvoice.status,
      document: {
        id: document.id,
        customerCompanyId: document.customerCompanyId,
        sourceJobId: document.sourceJobId,
        invoiceId: document.sourceInvoiceId,
        documentType: document.type,
        fileName: document.fileName,
        mimeType: document.mimeType,
        storageKey: document.storageKey,
        generatedByUserId: document.generatedByUserId,
        generatedByName: document.generatedBy?.name ?? document.generatedBy?.email ?? null,
        generatedAt: document.generatedAt,
        createdAt: document.createdAt,
      },
    };
  }

  async uploadInvoicePdf(
    tenantId: string,
    invoiceId: string,
    file: Express.Multer.File,
    user: any,
  ) {
    this.assertCustomerCanOnlyRead(user);
    const actorUserId: string | null = user?.userId ?? null;

    if (file.mimetype !== "application/pdf") {
      throw new BadRequestException("Only PDF files are allowed");
    }

    const inv = await this.prisma.invoice.findFirst({
      where: { tenantId, id: invoiceId },
      include: {
        orders: { select: { id: true, customerCompanyId: true } },
      },
    });

    if (!inv) {
      throw new BadRequestException("Invoice not found");
    }

    await this.assertCanAccessInvoice(tenantId, inv, user);

    if (!isInvoiceDraft(inv.status)) {
      throw new BadRequestException(invoiceCannotGenerateFromStatusMessage(inv.status));
    }

    if (!inv.customerCompanyId) {
      throw new BadRequestException(
        "Invoice must have a customerCompanyId before uploading a PDF",
      );
    }

    const sourceJob = inv.sourceJobId
      ? await this.prisma.job.findFirst({
          where: { tenantId, id: inv.sourceJobId },
          select: { internalRef: true },
        })
      : null;
    const sourceJobInternalRef = sourceJob?.internalRef ?? null;
    const { updatedInvoice } = await this.persistInvoicePdfSnapshot({
      tenantId,
      invoice: inv,
      customerCompanyId: inv.customerCompanyId,
      sourceJobId: inv.sourceJobId ?? null,
      sourceJobInternalRef,
      actorUserId,
      pdfBuffer: file.buffer,
    });

    rt.publishInvoiceEvent(this.realtime, "invoice.generated", tenantId, invoiceId, {
      jobId: inv.sourceJobId ?? null,
    });

    return this.toDtoWithNames(updatedInvoice);
  }

  private buildPortalInvoiceWhere(params: {
    tenantId: string;
    invoiceId?: string;
    customerCompanyId?: string;
    requireGeneratedAt?: boolean;
  }) {
    const where: any = {
      tenantId: params.tenantId,
      ...(params.invoiceId ? { id: params.invoiceId } : {}),
      status: { in: [INVOICE_STATUS.ISSUED, INVOICE_STATUS.PAID] },
      pdfKey: { not: null },
      ...(params.requireGeneratedAt ? { pdfGeneratedAt: { not: null } } : {}),
    };

    return where;
  }

  private async invoiceBelongsToCustomerCompany(
    tenantId: string,
    inv: any,
    customerCompanyId: string,
  ): Promise<boolean> {
    const [allowed] = await this.filterInvoicesBelongingToCustomerCompany(
      tenantId,
      [inv],
      customerCompanyId,
    );
    return !!allowed;
  }

  /**
   * Batch membership checks for company-scoped invoice visibility.
   * Preserves the same rules as the prior per-invoice path:
   * linked orders → snapshot.orderIds → customerName normalized match.
   */
  private async filterInvoicesBelongingToCustomerCompany(
    tenantId: string,
    invoices: any[],
    customerCompanyId: string,
  ): Promise<any[]> {
    if (!invoices.length) return [];

    const linkedOk: any[] = [];
    const needFurtherCheck: any[] = [];

    for (const inv of invoices) {
      const linkedMatches =
        inv?.orders?.some(
          (o: any) => o?.customerCompanyId === customerCompanyId,
        ) ?? false;
      if (linkedMatches) {
        linkedOk.push(inv);
      } else {
        needFurtherCheck.push(inv);
      }
    }

    if (!needFurtherCheck.length) return linkedOk;

    const allSnapshotOrderIds = new Set<string>();
    for (const inv of needFurtherCheck) {
      const snap = inv?.snapshot as any;
      const snapshotOrderIds = Array.isArray(snap?.orderIds)
        ? (snap.orderIds as string[])
        : [];
      for (const id of snapshotOrderIds) {
        const trimmed = String(id ?? "").trim();
        if (trimmed) allSnapshotOrderIds.add(trimmed);
      }
    }

    const matchingOrderIds = new Set<string>();
    if (allSnapshotOrderIds.size) {
      const orders = await this.prisma.transportOrder.findMany({
        where: {
          tenantId,
          id: { in: [...allSnapshotOrderIds] },
          customerCompanyId,
        },
        select: { id: true },
      });
      for (const order of orders) matchingOrderIds.add(order.id);
    }

    const company = await this.prisma.customer_companies.findFirst({
      where: { id: customerCompanyId, tenantId },
      select: { id: true, normalizedName: true },
    });

    const visible = [...linkedOk];
    for (const inv of needFurtherCheck) {
      const snap = inv?.snapshot as any;
      const snapshotOrderIds = Array.isArray(snap?.orderIds)
        ? (snap.orderIds as string[])
        : [];
      if (snapshotOrderIds.some((id) => matchingOrderIds.has(String(id)))) {
        visible.push(inv);
        continue;
      }

      const normalizedInvoiceCustomerName = normalizeCustomerCompanyName(
        inv?.customerName,
      );
      if (
        normalizedInvoiceCustomerName &&
        company?.normalizedName === normalizedInvoiceCustomerName
      ) {
        visible.push(inv);
      }
    }

    return visible;
  }

  private async invoicePdfExists(pdfKey: string): Promise<boolean> {
    const supabase = this.supabaseService.getClient();

    const key = String(pdfKey ?? "").trim();
    if (!key) return false;

    // Most reliable existence check: try to create a signed URL for the exact key.
    // If the object does not exist, Supabase returns an error.
    try {
      const { data, error } = await supabase.storage
        .from(INVOICE_DOCUMENTS_BUCKET)
        .createSignedUrl(key, 60);

      return !error && !!data?.signedUrl;
    } catch {
      return false;
    }
  }

  async listPortalInvoices(
    tenantId: string,
    customerCompanyId?: string,
  ): Promise<PortalInvoiceDto[]> {
    const customerCompanyName = customerCompanyId
      ? (
          await this.prisma.customer_companies.findFirst({
            where: { id: customerCompanyId, tenantId },
            select: { name: true },
          })
        )?.name ?? ""
      : "";

    const invoices = await this.prisma.invoice.findMany({
      where: this.buildPortalInvoiceWhere({
        tenantId,
        customerCompanyId,
        // Prefer pdfKey presence for list hasPdf; download still verifies storage.
        // Do not rely on pdfGeneratedAt (older data might have null metadata).
        requireGeneratedAt: false,
      }),
      orderBy: { createdAt: "desc" },
      include: {
        orders: {
          select: {
            customerCompanyId: true,
            customerCompany: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    const candidates = customerCompanyId
      ? await this.filterInvoicesBelongingToCustomerCompany(
          tenantId,
          invoices as any[],
          customerCompanyId,
        )
      : (invoices as any[]);

    const results: PortalInvoiceDto[] = [];
    for (const inv of candidates) {
      // List path: treat stored pdfKey as hasPdf without sequential signed-URL probes.
      // Download endpoint still verifies the object exists in storage.
      const hasPdf = Boolean(inv.pdfKey);
      if (!hasPdf) continue;

      const resolvedCustomerCompanyName =
        customerCompanyName || inv.orders?.[0]?.customerCompany?.name || "";

      results.push({
        id: inv.id,
        invoiceNumber: inv.invoiceNo,
        invoiceDate: inv.issueDate,
        dueDate: inv.dueDate ?? null,
        status: inv.status,
        currency: inv.currency,
        subtotalCents: inv.subtotalCents,
        taxCents: inv.taxCents,
        totalCents: inv.totalCents,
        customerCompany: { name: resolvedCustomerCompanyName },
        hasPdf: true,
        createdAt: inv.createdAt,
      });
    }

    return results;
  }

  async downloadPortalInvoicePdf(
    tenantId: string,
    invoiceId: string,
    customerCompanyId?: string,
  ): Promise<{ pdfBuffer: Buffer; filename: string }> {
    const inv = await this.prisma.invoice.findFirst({
      where: this.buildPortalInvoiceWhere({
        tenantId,
        invoiceId,
        customerCompanyId,
        requireGeneratedAt: false,
      }),
      select: {
        id: true,
        customerName: true,
        invoiceNo: true,
        pdfKey: true,
        snapshot: true,
        orders: { select: { customerCompanyId: true } },
      },
    });

    if (!inv?.pdfKey) {
      throw new NotFoundException("Invoice PDF not found");
    }

    if (customerCompanyId) {
      const allowed = await this.invoiceBelongsToCustomerCompany(
        tenantId,
        inv,
        customerCompanyId,
      );
      if (!allowed) {
        // Hide existence for other companies.
        throw new NotFoundException("Invoice PDF not found");
      }
    }

    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase.storage
      .from(INVOICE_DOCUMENTS_BUCKET)
      .download(inv.pdfKey);

    if (error || !data) {
      // Stale pdfKey: clear so portal list stops advertising a missing blob.
      // Do not restore per-row storage probes on list; download remains the verifier.
      await this.prisma.invoice.updateMany({
        where: {
          tenantId,
          id: invoiceId,
          pdfKey: inv.pdfKey,
        },
        data: { pdfKey: null },
      });
      throw new NotFoundException("Invoice PDF not found");
    }

    const raw: any = data;
    let pdfBuffer: Buffer;
    if (Buffer.isBuffer(raw)) pdfBuffer = raw;
    else if (typeof raw === "string") pdfBuffer = Buffer.from(raw);
    else if (typeof raw?.arrayBuffer === "function") {
      pdfBuffer = Buffer.from(await raw.arrayBuffer());
    } else {
      pdfBuffer = Buffer.from(raw);
    }

    const filename = `${this.safeFileName(inv.invoiceNo ?? invoiceId)}.pdf`;
    return { pdfBuffer, filename };
  }

  async getInvoicePdfDownloadUrl(
    tenantId: string,
    invoiceId: string,
    user: any,
  ) {
    const inv = await this.prisma.invoice.findFirst({
      where: { tenantId, id: invoiceId },
      include: {
        orders: { select: { id: true, customerCompanyId: true } },
      },
    });

    if (!inv) {
      throw new BadRequestException("Invoice not found");
    }

    await this.assertCanAccessInvoice(tenantId, inv, user);

    if (!inv.pdfKey) {
      throw new BadRequestException("Invoice PDF has not been uploaded yet");
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .storage.from(INVOICE_DOCUMENTS_BUCKET)
      .createSignedUrl(inv.pdfKey, this.PDF_SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      throw new BadRequestException(
        `Failed to create invoice download URL: ${error?.message ?? "unknown error"}`,
      );
    }

    return {
      url: data.signedUrl,
      fileName: `${this.safeFileName(inv.invoiceNo || "invoice")}.pdf`,
      expiresInSeconds: this.PDF_SIGNED_URL_TTL_SECONDS,
    };
  }
}

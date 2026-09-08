import { Prisma } from "@prisma/client";

/**
 * Customer invoice visibility (staff list + portal).
 *
 * Same rules as the previous in-memory filter:
 * 1. Linked TransportOrder.customerCompanyId matches, or
 * 2. snapshot.orderIds contains an order owned by that company, or
 * 3. normalized invoice.customerName equals the company's normalizedName
 *
 * Not equivalent to Invoice.customerCompanyId = X (that would change semantics).
 */

export function normalizeCustomerCompanyName(name: string): string {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function invoiceMatchesCustomerCompany(input: {
  customerName?: string | null;
  orders?: Array<{ customerCompanyId?: string | null } | null> | null;
  snapshot?: { orderIds?: unknown } | null;
  matchingSnapshotOrderIds?: ReadonlySet<string>;
  companyNormalizedName?: string | null;
  customerCompanyId: string;
}): boolean {
  const linkedMatches =
    input.orders?.some((o) => o?.customerCompanyId === input.customerCompanyId) ??
    false;
  if (linkedMatches) return true;

  const snapshotOrderIds = Array.isArray(input.snapshot?.orderIds)
    ? (input.snapshot!.orderIds as unknown[]).map((id) => String(id ?? "").trim())
    : [];
  if (
    snapshotOrderIds.some((id) => input.matchingSnapshotOrderIds?.has(id))
  ) {
    return true;
  }

  const normalizedInvoiceCustomerName = normalizeCustomerCompanyName(
    input.customerName ?? "",
  );
  return Boolean(
    normalizedInvoiceCustomerName &&
      input.companyNormalizedName === normalizedInvoiceCustomerName,
  );
}

/** Predicate for invoice alias `i`. */
export function customerInvoiceVisibilitySql(
  tenantId: string,
  customerCompanyId: string,
  companyNormalizedName: string,
): Prisma.Sql {
  const normalized = String(companyNormalizedName ?? "").trim();
  return Prisma.sql`
    (
      EXISTS (
        SELECT 1
        FROM "transport_orders" o
        WHERE o."invoiceId" = i.id
          AND o."tenantId" = ${tenantId}
          AND o."customerCompanyId" = ${customerCompanyId}
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          CASE
            WHEN i.snapshot IS NULL THEN '[]'::jsonb
            WHEN jsonb_typeof(i.snapshot->'orderIds') = 'array' THEN i.snapshot->'orderIds'
            ELSE '[]'::jsonb
          END
        ) AS snap(order_id)
        INNER JOIN "transport_orders" o
          ON o.id = snap.order_id
        WHERE o."tenantId" = ${tenantId}
          AND o."customerCompanyId" = ${customerCompanyId}
      )
      OR (
        ${normalized} <> ''
        AND lower(regexp_replace(btrim(i."customerName"), '\\s+', ' ', 'g')) = ${normalized}
      )
    )
  `;
}

const INVOICE_LIST_SORT_SQL: Record<
  string,
  { asc: Prisma.Sql; desc: Prisma.Sql }
> = {
  createdAt: {
    asc: Prisma.sql`i."createdAt" ASC, i.id DESC`,
    desc: Prisma.sql`i."createdAt" DESC, i.id DESC`,
  },
  updatedAt: {
    asc: Prisma.sql`i."updatedAt" ASC, i.id DESC`,
    desc: Prisma.sql`i."updatedAt" DESC, i.id DESC`,
  },
  invoiceNo: {
    asc: Prisma.sql`i."invoiceNo" ASC, i.id DESC`,
    desc: Prisma.sql`i."invoiceNo" DESC, i.id DESC`,
  },
  status: {
    asc: Prisma.sql`i.status ASC, i.id DESC`,
    desc: Prisma.sql`i.status DESC, i.id DESC`,
  },
  issueDate: {
    asc: Prisma.sql`i."issueDate" ASC, i.id DESC`,
    desc: Prisma.sql`i."issueDate" DESC, i.id DESC`,
  },
  issuedAt: {
    asc: Prisma.sql`i."issuedAt" ASC, i.id DESC`,
    desc: Prisma.sql`i."issuedAt" DESC, i.id DESC`,
  },
};

export function invoiceListOrderBySql(
  sortBy?: string,
  sortDir?: string,
): Prisma.Sql {
  const key = String(sortBy ?? "").trim();
  const pair = INVOICE_LIST_SORT_SQL[key];
  if (!pair) {
    return Prisma.sql`i."createdAt" DESC, i.id DESC`;
  }
  return sortDir === "desc" ? pair.desc : pair.asc;
}

export function invoiceListSearchSql(q?: string): Prisma.Sql {
  const term = String(q ?? "").trim();
  if (!term) return Prisma.empty;
  const pattern = `%${term}%`;
  return Prisma.sql`
    AND (
      i."invoiceNo" ILIKE ${pattern}
      OR i."customerName" ILIKE ${pattern}
    )
  `;
}

export function invoiceListStatusSql(status?: string): Prisma.Sql {
  const raw = String(status ?? "").trim();
  if (!raw || raw.toLowerCase() === "all") return Prisma.empty;
  const mapped: Record<string, string> = {
    Draft: "DRAFT",
    DRAFT: "DRAFT",
    Generated: "GENERATED",
    GENERATED: "GENERATED",
    Issued: "ISSUED",
    ISSUED: "ISSUED",
    Paid: "PAID",
    PAID: "PAID",
    Void: "VOID",
    VOID: "VOID",
  };
  const value = mapped[raw];
  if (!value) return Prisma.empty;
  return Prisma.sql`AND i.status = ${value}::"InvoiceStatus"`;
}

export function customerInvoiceListCountSql(input: {
  tenantId: string;
  customerCompanyId: string;
  companyNormalizedName: string;
  q?: string;
  status?: string;
}): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*)::bigint AS c
    FROM "invoices" i
    WHERE i."tenantId" = ${input.tenantId}
      ${invoiceListStatusSql(input.status)}
      ${invoiceListSearchSql(input.q)}
      AND ${customerInvoiceVisibilitySql(
        input.tenantId,
        input.customerCompanyId,
        input.companyNormalizedName,
      )}
  `;
}

export function customerInvoiceListPageSql(input: {
  tenantId: string;
  customerCompanyId: string;
  companyNormalizedName: string;
  q?: string;
  status?: string;
  sortBy?: string;
  sortDir?: string;
  skip: number;
  take: number;
}): Prisma.Sql {
  return Prisma.sql`
    SELECT i.id
    FROM "invoices" i
    WHERE i."tenantId" = ${input.tenantId}
      ${invoiceListStatusSql(input.status)}
      ${invoiceListSearchSql(input.q)}
      AND ${customerInvoiceVisibilitySql(
        input.tenantId,
        input.customerCompanyId,
        input.companyNormalizedName,
      )}
    ORDER BY ${invoiceListOrderBySql(input.sortBy, input.sortDir)}
    OFFSET ${input.skip}
    LIMIT ${input.take}
  `;
}

export function portalCustomerInvoiceIdsSql(input: {
  tenantId: string;
  customerCompanyId: string;
  companyNormalizedName: string;
}): Prisma.Sql {
  return Prisma.sql`
    SELECT i.id
    FROM "invoices" i
    WHERE i."tenantId" = ${input.tenantId}
      AND i.status IN ('ISSUED'::"InvoiceStatus", 'PAID'::"InvoiceStatus")
      AND i."pdfKey" IS NOT NULL
      AND ${customerInvoiceVisibilitySql(
        input.tenantId,
        input.customerCompanyId,
        input.companyNormalizedName,
      )}
    ORDER BY i."createdAt" DESC, i.id DESC
  `;
}

export function prismaSqlText(sql: Prisma.Sql): string {
  return ((sql as { strings?: string[] }).strings ?? []).join(" ");
}

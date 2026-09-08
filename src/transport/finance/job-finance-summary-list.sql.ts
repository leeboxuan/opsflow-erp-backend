import { Prisma } from "@prisma/client";
import { JOB_FINANCE_CURRENCY, type JobFinanceStatus } from "./job-finance-summary.helpers";

/**
 * Finance job-list filter map (Phase 5).
 *
 * Directly stored in SQL:
 * - tenantId, job id, internalRef, createdAt (pagination/sort)
 *
 * Derivable with joins/aggregates (pushed down before LIMIT):
 * - NOT_INVOICED: NOT EXISTS charge-backed ISSUED|PAID SGD invoice lines
 * - NEGATIVE / NON_NEGATIVE: EXISTS those lines AND canonical cost ≷ revenue
 *
 * Still computed in application code for the selected page only:
 * - driverPayoutCents (canonical trip payout lines, then cache)
 * - miscPayoutCents (approved SGD expenses)
 * - totalJobBillableCents (SGD JobCharge sum)
 * - invoiceRevenueCents (charge-backed line amount+tax; not Invoice.totalCents)
 * - differenceCents / financeStatus display values
 *
 * Intentionally unused for revenue (would change semantics):
 * - Invoice.totalCents, Invoice.sourceJobId, quotations, unattributable lines
 */

export function jobHasAttributableInvoiceSql(tenantId: string): Prisma.Sql {
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM "invoice_line_items" ili
      INNER JOIN "job_charges" jc
        ON jc.id = ili."jobChargeId"
       AND jc."tenantId" = ili."tenantId"
      INNER JOIN "invoices" inv
        ON inv.id = ili."invoiceId"
       AND inv."tenantId" = ili."tenantId"
      WHERE ili."tenantId" = ${tenantId}
        AND ili."jobChargeId" IS NOT NULL
        AND jc."jobId" = j.id
        AND jc."tenantId" = ${tenantId}
        AND inv."tenantId" = ${tenantId}
        AND inv.status IN ('ISSUED'::"InvoiceStatus", 'PAID'::"InvoiceStatus")
        AND UPPER(BTRIM(inv.currency)) = ${JOB_FINANCE_CURRENCY}
    )
  `;
}

/** Canonical driver payout for job alias `j` — mirrors sumDriverPayoutCentsForTrips. */
export function jobDriverPayoutCentsSql(tenantId: string): Prisma.Sql {
  return Prisma.sql`
    COALESCE((
      SELECT SUM(trip_payout)
      FROM (
        SELECT
          CASE
            WHEN COUNT(pl.id) > 0 THEN
              CASE
                WHEN COALESCE(SUM(
                  CASE
                    WHEN COALESCE(pl."isSelectableForTripEarning", true) IS NOT TRUE THEN 0
                    WHEN pl."totalCents" IS NOT NULL AND pl."totalCents" > 0 THEN pl."totalCents"
                    ELSE COALESCE(pl."amountCents", 0) * GREATEST(0, COALESCE(pl.quantity, 1))
                  END
                ), 0) > 0
                THEN COALESCE(SUM(
                  CASE
                    WHEN COALESCE(pl."isSelectableForTripEarning", true) IS NOT TRUE THEN 0
                    WHEN pl."totalCents" IS NOT NULL AND pl."totalCents" > 0 THEN pl."totalCents"
                    ELSE COALESCE(pl."amountCents", 0) * GREATEST(0, COALESCE(pl.quantity, 1))
                  END
                ), 0)
                ELSE 0
              END
            WHEN t."driverEarningCents" IS NOT NULL AND t."driverEarningCents" > 0 THEN t."driverEarningCents"
            ELSE 0
          END AS trip_payout
        FROM "trips" t
        LEFT JOIN "trip_payout_lines" pl
          ON pl."tripId" = t.id
         AND pl."tenantId" = t."tenantId"
        WHERE t."tenantId" = ${tenantId}
          AND t."jobId" = j.id
          AND t.status::text <> 'CANCELLED'
        GROUP BY t.id, t."driverEarningCents"
      ) trip_costs
    ), 0)
  `;
}

export function jobMiscPayoutCentsSql(tenantId: string): Prisma.Sql {
  return Prisma.sql`
    COALESCE((
      SELECT SUM(te."amountCents")
      FROM "trip_expenses" te
      WHERE te."tenantId" = ${tenantId}
        AND te."jobId" = j.id
        AND te."reviewStatus"::text = 'APPROVED'
        AND UPPER(BTRIM(te.currency)) = ${JOB_FINANCE_CURRENCY}
    ), 0)
  `;
}

export function jobAttributableInvoiceRevenueCentsSql(
  tenantId: string,
): Prisma.Sql {
  return Prisma.sql`
    COALESCE((
      SELECT SUM(GREATEST(0, ili."amountCents") + GREATEST(0, ili."taxCents"))
      FROM "invoice_line_items" ili
      INNER JOIN "job_charges" jc
        ON jc.id = ili."jobChargeId"
       AND jc."tenantId" = ili."tenantId"
      INNER JOIN "invoices" inv
        ON inv.id = ili."invoiceId"
       AND inv."tenantId" = ili."tenantId"
      WHERE ili."tenantId" = ${tenantId}
        AND ili."jobChargeId" IS NOT NULL
        AND jc."jobId" = j.id
        AND jc."tenantId" = ${tenantId}
        AND inv."tenantId" = ${tenantId}
        AND inv.status IN ('ISSUED'::"InvoiceStatus", 'PAID'::"InvoiceStatus")
        AND UPPER(BTRIM(inv.currency)) = ${JOB_FINANCE_CURRENCY}
    ), 0)
  `;
}

export function jobFinanceStatusWhereSql(
  tenantId: string,
  financeStatus: JobFinanceStatus,
): Prisma.Sql {
  const hasInvoice = jobHasAttributableInvoiceSql(tenantId);
  const cost = Prisma.sql`(${jobDriverPayoutCentsSql(tenantId)} + ${jobMiscPayoutCentsSql(tenantId)})`;
  const revenue = jobAttributableInvoiceRevenueCentsSql(tenantId);

  if (financeStatus === "NOT_INVOICED") {
    return Prisma.sql`AND NOT (${hasInvoice})`;
  }
  if (financeStatus === "NEGATIVE") {
    return Prisma.sql`AND (${hasInvoice}) AND ${cost} > ${revenue}`;
  }
  return Prisma.sql`AND (${hasInvoice}) AND ${cost} <= ${revenue}`;
}

export function jobFinanceSummaryCountSql(
  tenantId: string,
  financeStatus: JobFinanceStatus,
): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*)::bigint AS c
    FROM "jobs" j
    WHERE j."tenantId" = ${tenantId}
      ${jobFinanceStatusWhereSql(tenantId, financeStatus)}
  `;
}

export function jobFinanceSummaryPageSql(
  tenantId: string,
  financeStatus: JobFinanceStatus,
  skip: number,
  take: number,
): Prisma.Sql {
  return Prisma.sql`
    SELECT j.id, j."internalRef"
    FROM "jobs" j
    WHERE j."tenantId" = ${tenantId}
      ${jobFinanceStatusWhereSql(tenantId, financeStatus)}
    ORDER BY j."createdAt" DESC, j.id DESC
    OFFSET ${skip}
    LIMIT ${take}
  `;
}

export function prismaSqlText(sql: Prisma.Sql): string {
  return ((sql as { strings?: string[] }).strings ?? []).join(" ");
}

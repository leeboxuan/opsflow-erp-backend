import {
  invoiceMatchesCustomerCompany,
  invoiceListSearchSql,
  invoiceListStatusSql,
  prismaSqlText,
  customerInvoiceVisibilitySql,
  portalCustomerInvoiceIdsSql,
} from "./customer-invoice-visibility";
import {
  jobFinanceStatusWhereSql,
  jobFinanceSummaryPageSql,
  prismaSqlText as financeSqlText,
} from "./job-finance-summary-list.sql";

describe("customer invoice visibility predicates", () => {
  const companyId = "co-a";

  it("matches linked orders, snapshot order ids, and normalized names", () => {
    expect(
      invoiceMatchesCustomerCompany({
        customerCompanyId: companyId,
        orders: [{ customerCompanyId: companyId }],
      }),
    ).toBe(true);

    expect(
      invoiceMatchesCustomerCompany({
        customerCompanyId: companyId,
        customerName: "Other",
        orders: [{ customerCompanyId: "co-b" }],
        snapshot: { orderIds: ["ord-1"] },
        matchingSnapshotOrderIds: new Set(["ord-1"]),
      }),
    ).toBe(true);

    expect(
      invoiceMatchesCustomerCompany({
        customerCompanyId: companyId,
        customerName: "  Acme   Logistics ",
        orders: [],
        snapshot: { orderIds: [] },
        matchingSnapshotOrderIds: new Set(),
        companyNormalizedName: "acme logistics",
      }),
    ).toBe(true);
  });

  it("rejects another company and does not use invoice.customerCompanyId alone", () => {
    expect(
      invoiceMatchesCustomerCompany({
        customerCompanyId: companyId,
        customerName: "Acme",
        orders: [{ customerCompanyId: "co-b" }],
        snapshot: { orderIds: ["ord-x"] },
        matchingSnapshotOrderIds: new Set(["ord-other"]),
        companyNormalizedName: "beta ltd",
      }),
    ).toBe(false);
  });

  it("SQL visibility is not a naive customerCompanyId column filter", () => {
    const sql = prismaSqlText(
      customerInvoiceVisibilitySql("t1", "co-a", "acme logistics"),
    );
    expect(sql).toContain("transport_orders");
    expect(sql).toContain("orderIds");
    expect(sql).toContain("customerName");
    expect(sql).not.toMatch(/i\."customerCompanyId"\s*=/);
  });

  it("search and status are AND-ed with visibility, not mixed into OR", () => {
    const search = prismaSqlText(invoiceListSearchSql("inv"));
    const status = prismaSqlText(invoiceListStatusSql("ISSUED"));
    expect(search).toContain("ILIKE");
    expect(status).toContain("InvoiceStatus");
    const portal = prismaSqlText(
      portalCustomerInvoiceIdsSql({
        tenantId: "t1",
        customerCompanyId: "co-a",
        companyNormalizedName: "acme",
      }),
    );
    expect(portal).toContain("pdfKey");
    expect(portal).toContain("ISSUED");
  });
});

describe("finance summary SQL filter pushdown", () => {
  it("NOT_INVOICED uses NOT EXISTS charge-backed lines, never Invoice.totalCents", () => {
    const sql = financeSqlText(jobFinanceStatusWhereSql("t1", "NOT_INVOICED"));
    expect(sql).toContain("NOT");
    expect(sql).toContain("invoice_line_items");
    expect(sql).toContain("job_charges");
    expect(sql).not.toContain("totalCents");
    expect(sql).not.toContain("sourceJobId");
  });

  it("NEGATIVE compares canonical cost to attributable revenue before LIMIT", () => {
    const sql = financeSqlText(jobFinanceSummaryPageSql("t1", "NEGATIVE", 20, 20));
    expect(sql).toContain("OFFSET");
    expect(sql).toContain("LIMIT");
    expect(sql).toContain("trip_payout_lines");
    expect(sql).toContain("trip_expenses");
    expect(sql).toContain("APPROVED");
    expect(sql).toContain("createdAt");
    expect(sql).not.toContain('inv."totalCents"');
    expect(sql).not.toContain("sourceJobId");
  });
});

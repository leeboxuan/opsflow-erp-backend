import {
  aggregateAttributableInvoiceRevenueByJob,
  isChargeBackedAttributableLine,
  lineRevenueCents,
  sumUnattributableRecognizedLineRevenueCents,
  type InvoiceLineAttributionInput,
} from "./job-finance-invoice-attribution";

function line(
  partial: Partial<InvoiceLineAttributionInput> &
    Pick<InvoiceLineAttributionInput, "lineId" | "jobId" | "jobChargeId">,
): InvoiceLineAttributionInput {
  return {
    lineTenantId: "t1",
    amountCents: 1000,
    taxCents: 90,
    chargeTenantId: "t1",
    invoiceId: "inv-1",
    invoiceTenantId: "t1",
    invoiceStatus: "ISSUED",
    invoiceCurrency: "SGD",
    ...partial,
  };
}

describe("job-finance-invoice-attribution", () => {
  it("includes line tax with amount for attributable revenue", () => {
    expect(lineRevenueCents({ amountCents: 1000, taxCents: 90 })).toBe(1090);
  });

  it("attributes a single-job invoice via charge provenance", () => {
    const byJob = aggregateAttributableInvoiceRevenueByJob(
      [
        line({
          lineId: "l1",
          jobChargeId: "jc-a",
          jobId: "job-a",
          amountCents: 5000,
          taxCents: 450,
        }),
      ],
      "t1",
      ["job-a"],
    );
    expect(byJob.get("job-a")).toBe(5450);
  });

  it("splits a multi-job invoice without duplicating Invoice.totalCents", () => {
    const byJob = aggregateAttributableInvoiceRevenueByJob(
      [
        line({
          lineId: "l1",
          jobChargeId: "jc-a",
          jobId: "job-a",
          amountCents: 3000,
          taxCents: 270,
          invoiceId: "inv-multi",
        }),
        line({
          lineId: "l2",
          jobChargeId: "jc-b",
          jobId: "job-b",
          amountCents: 7000,
          taxCents: 630,
          invoiceId: "inv-multi",
        }),
        // Manual line on same invoice — unattributable
        line({
          lineId: "l-manual",
          jobChargeId: null,
          jobId: null,
          amountCents: 9999,
          taxCents: 0,
          invoiceId: "inv-multi",
        }),
      ],
      "t1",
      ["job-a", "job-b"],
    );
    expect(byJob.get("job-a")).toBe(3270);
    expect(byJob.get("job-b")).toBe(7630);
    expect((byJob.get("job-a") ?? 0) + (byJob.get("job-b") ?? 0)).toBe(10900);
    expect(byJob.has("job-a")).toBe(true);
    expect(
      sumUnattributableRecognizedLineRevenueCents(
        [
          line({
            lineId: "l-manual",
            jobChargeId: null,
            jobId: null,
            amountCents: 9999,
            taxCents: 0,
          }),
        ],
        "t1",
      ),
    ).toBe(9999);
  });

  it("does not invent revenue from sourceJob-only linkage (no charge)", () => {
    const byJob = aggregateAttributableInvoiceRevenueByJob(
      [
        line({
          lineId: "manual-only",
          jobChargeId: null,
          jobId: null,
          amountCents: 8000,
          taxCents: 0,
        }),
      ],
      "t1",
      ["job-primary"],
    );
    expect(byJob.has("job-primary")).toBe(false);
  });

  it("adds multiple legitimate partial invoices for one job", () => {
    const byJob = aggregateAttributableInvoiceRevenueByJob(
      [
        line({
          lineId: "p1",
          invoiceId: "inv-1",
          jobChargeId: "jc-1",
          jobId: "job-a",
          amountCents: 1000,
          taxCents: 0,
        }),
        line({
          lineId: "p2",
          invoiceId: "inv-2",
          jobChargeId: "jc-2",
          jobId: "job-a",
          amountCents: 2500,
          taxCents: 0,
          invoiceStatus: "PAID",
        }),
      ],
      "t1",
      ["job-a"],
    );
    expect(byJob.get("job-a")).toBe(3500);
  });

  it("dedupes repeated line ids and ignores DRAFT/VOID", () => {
    const rows = [
      line({
        lineId: "same",
        jobChargeId: "jc-1",
        jobId: "job-a",
        amountCents: 1000,
        taxCents: 0,
      }),
      line({
        lineId: "same",
        jobChargeId: "jc-1",
        jobId: "job-a",
        amountCents: 1000,
        taxCents: 0,
      }),
      line({
        lineId: "voided",
        jobChargeId: "jc-2",
        jobId: "job-a",
        amountCents: 5000,
        taxCents: 0,
        invoiceStatus: "VOID",
      }),
      line({
        lineId: "draft",
        jobChargeId: "jc-3",
        jobId: "job-a",
        amountCents: 4000,
        taxCents: 0,
        invoiceStatus: "DRAFT",
      }),
    ];
    expect(aggregateAttributableInvoiceRevenueByJob(rows, "t1").get("job-a")).toBe(
      1000,
    );
  });

  it("fails closed on cross-tenant charge or invoice provenance", () => {
    expect(
      isChargeBackedAttributableLine(
        line({
          lineId: "x",
          jobChargeId: "jc",
          jobId: "job-a",
          chargeTenantId: "other",
        }),
        "t1",
      ),
    ).toBe(false);
    expect(
      aggregateAttributableInvoiceRevenueByJob(
        [
          line({
            lineId: "x",
            jobChargeId: "jc",
            jobId: "job-a",
            invoiceTenantId: "other",
          }),
        ],
        "t1",
      ).size,
    ).toBe(0);
  });
});

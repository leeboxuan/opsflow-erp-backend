import { JobChargeSourceType } from "@prisma/client";
import {
  buildCustomerQuotationChargeSnapshot,
  CHARGE_OPTION_SOURCE,
  jobChargeProvenanceLabel,
  jobChargeQtyFromQuotationQty,
  mapCustomerQuotationLinesToChargeOptions,
  mapCustomerRateTemplateRowsToChargeOptions,
  normalizeOptionalId,
} from "./job-commercial-provenance";

describe("job commercial provenance helpers", () => {
  it("normalizes optional ids", () => {
    expect(normalizeOptionalId(undefined)).toBeUndefined();
    expect(normalizeOptionalId(null)).toBeNull();
    expect(normalizeOptionalId("")).toBeNull();
    expect(normalizeOptionalId("  qt-1  ")).toBe("qt-1");
  });

  it("truncates quotation qty to a positive integer", () => {
    expect(jobChargeQtyFromQuotationQty(1.8)).toBe(1);
    expect(jobChargeQtyFromQuotationQty(0)).toBe(1);
    expect(jobChargeQtyFromQuotationQty(null)).toBe(1);
  });

  it("labels saved charge provenance without raw ids", () => {
    expect(
      jobChargeProvenanceLabel({
        sourceType: JobChargeSourceType.CUSTOMER_QUOTATION,
        sourceCustomerQuotationLineId: "line-1",
        metadataJson: { quotationSnapshot: { quotationNo: "QT-202608-0001" } },
      }),
    ).toBe("From QT-202608-0001");
    expect(
      jobChargeProvenanceLabel({
        sourceType: JobChargeSourceType.CUSTOMER_QUOTATION,
        sourceCustomerQuotationLineId: null,
        metadataJson: null,
      }),
    ).toBe("Legacy master rate");
    expect(
      jobChargeProvenanceLabel({
        sourceType: JobChargeSourceType.DHC_REFERENCE,
        metadataJson: null,
      }),
    ).toBe("DHC Reference");
    expect(
      jobChargeProvenanceLabel({
        sourceType: JobChargeSourceType.MANUAL,
        metadataJson: { customerRateTemplateSnapshot: { templateId: "t1" } },
      }),
    ).toBe("Customer rates");
    expect(
      jobChargeProvenanceLabel({
        sourceType: JobChargeSourceType.MANUAL,
        metadataJson: null,
      }),
    ).toBe("Manual");
  });

  it("maps quotation lines with CUSTOMER_QUOTATION source", () => {
    const options = mapCustomerQuotationLinesToChargeOptions(
      [
        {
          id: "line-1",
          code: "A1",
          label: "Haulage",
          qty: 2,
          unitPriceCents: 12500,
        },
      ],
      { id: "q1", quotationNo: "QT-1", title: "Standard" },
    );
    expect(options[0]).toMatchObject({
      id: "line-1",
      source: CHARGE_OPTION_SOURCE.CUSTOMER_QUOTATION,
      sourceCustomerQuotationLineId: "line-1",
      quotationNo: "QT-1",
      unitPriceCents: 12500,
      defaultQty: 2,
    });
  });

  it("maps customer rate template rows without pretending they are quotations", () => {
    const options = mapCustomerRateTemplateRowsToChargeOptions(
      [{ id: "row-1", code: "R1", label: "Default haulage", rateCents: 9000 }],
      { id: "tmpl-1", name: "Default rate template" },
    );
    expect(options[0].source).toBe(CHARGE_OPTION_SOURCE.CUSTOMER_RATE_TEMPLATE);
    expect(options[0].sourceCustomerQuotationLineId).toBeNull();
  });

  it("snapshots quotation line amounts onto JobCharge fields", () => {
    const snapshot = buildCustomerQuotationChargeSnapshot({
      line: {
        id: "line-1",
        code: "A1",
        label: "Haulage",
        unitPriceCents: 10000,
        taxCode: "SR",
        taxRate: 900,
      },
      quotation: { id: "q1", quotationNo: "QT-1", title: "Standard" },
      qty: 2,
      unitPriceCents: 11000,
      capturedAt: new Date("2026-08-13T00:00:00.000Z"),
    });
    expect(snapshot.sourceType).toBe(JobChargeSourceType.CUSTOMER_QUOTATION);
    expect(snapshot.sourceCustomerQuotationLineId).toBe("line-1");
    expect(snapshot.amountCents).toBe(22000);
    expect(snapshot.metadataJson.quotationSnapshot.quotationNo).toBe("QT-1");
  });
});

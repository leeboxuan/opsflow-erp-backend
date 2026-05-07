import {
  loadInvoiceAssetDataUri,
  renderDbWisdomInvoiceHtml,
  renderWisdomForceInvoiceHtml,
} from "./invoice-render";

describe("invoice-render assets", () => {
  const baseData = {
    invoiceNo: "INV-1",
    templateCode: "WISDOM_FORCE",
    sellerName: "Wisdom Force Logistics Pte Ltd",
    sellerUen: "202606497W",
    sellerAddress: "Singapore",
    customerName: "Customer A",
    customerBillingAddress: "Addr",
    issueDateISO: "2026-05-07",
    dueDateISO: "2026-05-21",
    reference: "REF",
    currency: "SGD",
    taxRatePercent: 9,
    lines: [
      {
        description: "Line 1",
        qty: 1,
        unitPriceCents: 10000,
        amountCents: 10000,
        taxLabel: "9%",
      },
    ],
    subtotalCents: 10000,
    taxCents: 900,
    totalCents: 10900,
    amountPaidCents: 0,
    amountDueCents: 10900,
    paymentInstructions: "Pay by transfer",
  };

  it("WISDOM_FORCE rendered HTML contains logo and QR base64 data URIs", () => {
    const html = renderWisdomForceInvoiceHtml({
      ...baseData,
      lines: [
        {
          description:
            "WF-0002-IMP-T01\nFrom: JURONG_PORT - Jurong Port\nTo: Cogent 1.Logistics Hub, 1 Buroh Crescent",
          qty: 1,
          unitPriceCents: 10000,
          amountCents: 10000,
          taxLabel: "9%",
        },
      ],
    } as any);
    expect(html).toContain("data:image/jpeg;base64,");
    expect(html).toMatch(/data:image\/(png|jpeg);base64,/);
    expect(html).toContain("white-space:pre-line");
    expect(html).toContain("Amount Due</span><span>SGD 109.00");
    expect(html).not.toContain("Amount Due SGD SGD");
    expect(html).not.toContain("Invoice Total SGD SGD");
    expect(html).toContain("PayNow / SGQR");
  });

  it("asset loader returns null for missing file without throwing", () => {
    expect(loadInvoiceAssetDataUri("__missing__.jpeg", "image/jpeg")).toBeNull();
  });

  it("DB_WISDOM render path remains unchanged (no wisdom force asset labels)", () => {
    const html = renderDbWisdomInvoiceHtml({
      ...baseData,
      templateCode: "DB_WISDOM",
    } as any);
    expect(html).not.toContain("PayNow / SGQR");
    expect(html).not.toContain("data:image/jpeg;base64,");
  });
});

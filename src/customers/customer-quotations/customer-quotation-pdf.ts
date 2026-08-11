import { PDFDocument, PDFPage, StandardFonts, PDFFont } from "pdf-lib";

export type CustomerQuotationPdfLine = {
  code: string;
  label: string;
  description?: string | null;
  qty: number;
  unitPriceCents: number;
  amountCents: number;
  taxCents: number;
};

export type CustomerQuotationPdfRenderData = {
  quotationNo: string;
  title?: string | null;
  customerName: string;
  currency: string;
  issueDateISO: string;
  validUntilISO?: string | null;
  notes?: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  taxRatePercent: number;
  lines: CustomerQuotationPdfLine[];
};

function money(cents: number, currency: string): string {
  return `${currency} ${(Number(cents || 0) / 100).toFixed(2)}`;
}

/**
 * Multi-page pdf-lib quotation snapshot from frozen persisted totals/lines.
 * Every line is rendered; totals always come from renderData (server snapshot).
 */
export async function createCustomerQuotationPdfBuffer(
  renderData: CustomerQuotationPdfRenderData,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const marginX = 42;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const contentRight = pageWidth - marginX;
  const bottomMargin = 72;

  let page: PDFPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = 800;

  const ensureSpace = (needed: number) => {
    if (y - needed >= bottomMargin) return;
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    y = pageHeight - 48;
    page.drawText(`Quotation ${renderData.quotationNo} (cont.)`, {
      x: marginX,
      y,
      size: 10,
      font: bold,
    });
    y -= 24;
    page.drawText("Code", { x: marginX, y, size: 10, font: bold });
    page.drawText("Description", { x: 110, y, size: 10, font: bold });
    page.drawText("Qty", { x: 360, y, size: 10, font: bold });
    page.drawText("Unit", { x: 400, y, size: 10, font: bold });
    page.drawText("Amount", { x: 480, y, size: 10, font: bold });
    y -= 6;
    page.drawLine({
      start: { x: marginX, y },
      end: { x: contentRight, y },
      thickness: 0.8,
    });
  };

  const drawHeader = (p: PDFPage, fontR: PDFFont, fontB: PDFFont) => {
    let hy = 800;
    p.drawText("QUOTATION", { x: marginX, y: hy, size: 18, font: fontB });
    hy -= 22;
    p.drawText(`Quotation No: ${renderData.quotationNo}`, {
      x: marginX,
      y: hy,
      size: 11,
      font: fontR,
    });
    hy -= 14;
    p.drawText(`Issue Date: ${renderData.issueDateISO}`, {
      x: marginX,
      y: hy,
      size: 10,
      font: fontR,
    });
    if (renderData.validUntilISO) {
      hy -= 14;
      p.drawText(`Valid Until: ${renderData.validUntilISO}`, {
        x: marginX,
        y: hy,
        size: 10,
        font: fontR,
      });
    }
    if (renderData.title) {
      hy -= 16;
      p.drawText(String(renderData.title).slice(0, 90), {
        x: marginX,
        y: hy,
        size: 11,
        font: fontB,
      });
    }
    hy -= 28;
    p.drawText("Customer", { x: marginX, y: hy, size: 11, font: fontB });
    hy -= 14;
    p.drawText(String(renderData.customerName ?? "").slice(0, 80), {
      x: marginX,
      y: hy,
      size: 10,
      font: fontR,
    });
    hy -= 28;
    p.drawText("Code", { x: marginX, y: hy, size: 10, font: fontB });
    p.drawText("Description", { x: 110, y: hy, size: 10, font: fontB });
    p.drawText("Qty", { x: 360, y: hy, size: 10, font: fontB });
    p.drawText("Unit", { x: 400, y: hy, size: 10, font: fontB });
    p.drawText("Amount", { x: 480, y: hy, size: 10, font: fontB });
    hy -= 6;
    p.drawLine({
      start: { x: marginX, y: hy },
      end: { x: contentRight, y: hy },
      thickness: 0.8,
    });
    return hy;
  };

  y = drawHeader(page, font, bold);

  for (const line of renderData.lines) {
    ensureSpace(18);
    y -= 16;
    const desc = `${line.label}${line.description ? ` — ${line.description}` : ""}`.slice(
      0,
      48,
    );
    page.drawText(String(line.code).slice(0, 12), {
      x: marginX,
      y,
      size: 9,
      font,
    });
    page.drawText(desc, { x: 110, y, size: 9, font });
    page.drawText(String(line.qty), { x: 360, y, size: 9, font });
    page.drawText((Number(line.unitPriceCents || 0) / 100).toFixed(2), {
      x: 400,
      y,
      size: 9,
      font,
    });
    page.drawText((Number(line.amountCents || 0) / 100).toFixed(2), {
      x: 480,
      y,
      size: 9,
      font,
    });
  }

  ensureSpace(100);
  y -= 20;
  page.drawLine({
    start: { x: 360, y },
    end: { x: contentRight, y },
    thickness: 0.8,
  });
  y -= 16;
  page.drawText("Subtotal", { x: 370, y, size: 10, font });
  page.drawText(money(renderData.subtotalCents, renderData.currency), {
    x: 470,
    y,
    size: 10,
    font,
  });
  y -= 14;
  page.drawText(`GST ${renderData.taxRatePercent}%`, {
    x: 370,
    y,
    size: 10,
    font,
  });
  page.drawText(money(renderData.taxCents, renderData.currency), {
    x: 470,
    y,
    size: 10,
    font,
  });
  y -= 16;
  page.drawText("Total", { x: 370, y, size: 11, font: bold });
  page.drawText(money(renderData.totalCents, renderData.currency), {
    x: 470,
    y,
    size: 11,
    font: bold,
  });

  if (renderData.notes) {
    ensureSpace(50);
    y -= 36;
    page.drawText("Notes", { x: marginX, y, size: 10, font: bold });
    y -= 14;
    page.drawText(String(renderData.notes).slice(0, 110), {
      x: marginX,
      y,
      size: 9,
      font,
    });
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

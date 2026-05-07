import * as fs from "fs";
import * as path from "path";

export type RenderInvoiceLine = {
  description: string;
  qty: number;
  unitPriceCents: number;
  amountCents: number;
  taxLabel: string;
};

export type InvoiceRenderData = {
  invoiceNo: string;
  templateCode: string;
  sellerName: string;
  sellerUen?: string | null;
  sellerAddress?: string | null;
  customerName: string;
  customerBillingAddress?: string | null;
  issueDateISO: string;
  dueDateISO?: string | null;
  reference?: string | null;
  currency: string;
  taxRatePercent: number;
  lines: RenderInvoiceLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents: number;
  amountDueCents: number;
  paymentInstructions?: string | null;
};

function money(cents: number, currency = "SGD"): string {
  const value = (Number(cents || 0) / 100).toFixed(2);
  return `${currency} ${value}`;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveAssetCandidates(fileName: string): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "src", "finance", "assets", fileName),
    path.join(cwd, "dist", "finance", "assets", fileName),
    path.join(cwd, "dist", "src", "finance", "assets", fileName),
    path.join(cwd, "assets", fileName),
  ];
}

export function loadInvoiceAssetBuffer(fileName: string): Buffer | null {
  for (const p of resolveAssetCandidates(fileName)) {
    try {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p);
      }
    } catch {
      // ignore and continue to next candidate
    }
  }
  // Non-fatal by design; renderer falls back to text placeholders.
  console.warn("[invoice-render] asset not found", { fileName });
  return null;
}

export function loadInvoiceAssetDataUri(
  fileName: string,
  mimeType = "image/jpeg",
): string | null {
  const buf = loadInvoiceAssetBuffer(fileName);
  if (!buf) return null;
  return `data:${mimeType};base64,${buf.toString("base64")}`;
}

export function renderDbWisdomInvoiceHtml(data: InvoiceRenderData): string {
  const rows = data.lines.map((l) => `
    <tr>
      <td>${esc(l.description)}</td>
      <td class="n">${l.qty}</td>
      <td class="n">${money(l.unitPriceCents, data.currency)}</td>
      <td class="n">${esc(l.taxLabel)}</td>
      <td class="n">${money(l.amountCents, data.currency)}</td>
    </tr>
  `).join("");
  return `
<!doctype html>
<html><head><meta charset="utf-8"><style>
body{font-family:Arial,sans-serif;color:#222;padding:24px}
h1{margin:0 0 8px;font-size:20px}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border:1px solid #ddd;padding:8px;font-size:12px}
.n{text-align:right}
.meta{display:flex;justify-content:space-between;gap:16px}
</style></head><body>
<h1>TAX INVOICE</h1>
<div class="meta">
  <div><strong>${esc(data.sellerName)}</strong><div>${esc(data.sellerAddress ?? "")}</div></div>
  <div>
    <div>Invoice No: ${esc(data.invoiceNo)}</div>
    <div>Date: ${esc(data.issueDateISO)}</div>
    <div>Due: ${esc(data.dueDateISO ?? "")}</div>
    <div>Reference: ${esc(data.reference ?? "")}</div>
  </div>
</div>
<div style="margin-top:10px"><strong>Bill To:</strong> ${esc(data.customerName)}<br/>${esc(data.customerBillingAddress ?? "")}</div>
<table><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Tax</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div style="margin-top:16px;text-align:right">
  <div>Subtotal: ${money(data.subtotalCents, data.currency)}</div>
  <div>Tax: ${money(data.taxCents, data.currency)}</div>
  <div><strong>Total: ${money(data.totalCents, data.currency)}</strong></div>
</div>
</body></html>`;
}

export function renderWisdomForceInvoiceHtml(data: InvoiceRenderData): string {
  const logoDataUri = loadInvoiceAssetDataUri("WF-logo.jpeg", "image/jpeg");
  const qrDataUri = loadInvoiceAssetDataUri("WF-QR.jpeg", "image/jpeg");
  const logoBlock = logoDataUri
    ? `<img src="${logoDataUri}" alt="Wisdom Force Logo" style="width:200px;height:auto;object-fit:contain"/>`
    : `<strong style="font-size:18px;letter-spacing:0.4px">WISDOM FORCE LOGISTICS PTE LTD</strong>`;
  const qrBlock = qrDataUri
    ? `<img src="${qrDataUri}" alt="PayNow SGQR" style="width:210px;height:auto;object-fit:contain"/>`
    : `<div style="height:210px;border:1px dashed #9aa3af;display:flex;align-items:center;justify-content:center" class="muted">PayNow QR unavailable</div>`;

  const rows = data.lines.map((l) => `
    <tr>
      <td>${esc(l.description)}</td>
      <td class="n">${l.qty}</td>
      <td class="n">${money(l.unitPriceCents, data.currency)}</td>
      <td class="n">${esc(l.taxLabel)}</td>
      <td class="n">${money(l.amountCents, data.currency)}</td>
    </tr>
  `).join("");
  return `
<!doctype html>
<html><head><meta charset="utf-8"><style>
@page{size:A4;margin:18mm}
*{box-sizing:border-box}
body{font-family:Arial,sans-serif;color:#1f2937;font-size:12px;line-height:1.35}
h1{font-size:24px;margin:0}
h2{font-size:13px;margin:0 0 8px;color:#111827;letter-spacing:0.2px}
table{width:100%;border-collapse:collapse}
th,td{padding:8px 10px;border-bottom:1px solid #d1d5db}
th{background:#f9fafb;color:#374151;border-top:1px solid #d1d5db}
.n{text-align:right}
.wf-header{display:grid;grid-template-columns:1fr 270px;gap:22px;align-items:start;padding-bottom:14px;border-bottom:2px solid #e5e7eb}
.wf-company{margin-top:10px}
.wf-company strong{display:block;font-size:12px;color:#111827}
.wf-title{text-align:right}
.wf-title .sub{font-size:11px;color:#6b7280;margin-top:4px}
.meta-card{margin-top:12px;border:1px solid #d1d5db;border-radius:6px;overflow:hidden}
.meta-row{display:grid;grid-template-columns:118px 1fr}
.meta-row div{padding:6px 8px}
.meta-row div:first-child{background:#f9fafb;color:#6b7280}
.meta-row+ .meta-row{border-top:1px solid #e5e7eb}
.billto{margin-top:16px;border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;background:#fff}
.table-wrap{margin-top:16px;border:1px solid #d1d5db;border-radius:6px;overflow:hidden}
.totals{margin-top:14px;width:360px;margin-left:auto;border:1px solid #d1d5db;border-radius:6px;padding:10px 12px}
.totals div{display:flex;justify-content:space-between;padding:4px 0}
.totals .due{font-size:14px;font-weight:700;color:#0f172a;border-top:1px solid #d1d5db;margin-top:6px;padding-top:8px}
.muted{color:#6b7280}
.page-break{page-break-before:always}
.payment-grid{display:grid;grid-template-columns:1fr 260px;gap:20px;align-items:start}
.payment-card{border:1px solid #d1d5db;border-radius:6px;padding:12px;background:#fff}
.qr-card{border:1px solid #d1d5db;border-radius:8px;padding:10px;text-align:center;background:#fff}
.qr-title{font-weight:700;margin-bottom:4px}
.qr-sub{font-size:11px;color:#6b7280;margin-bottom:8px}
</style></head><body>
<div class="wf-header">
  <div>
    ${logoBlock}
    <div class="wf-company">
      <strong>${esc(data.sellerName)}</strong>
      <div>${esc(data.sellerAddress ?? "")}</div>
      <div>UEN / GST: ${esc(data.sellerUen ?? "")}</div>
    </div>
  </div>
  <div class="wf-title">
    <h1>TAX INVOICE</h1>
    <div class="sub">Payment Advice</div>
    <div class="meta-card">
      <div class="meta-row"><div>Invoice No</div><div>${esc(data.invoiceNo)}</div></div>
      <div class="meta-row"><div>Invoice Date</div><div>${esc(data.issueDateISO)}</div></div>
      <div class="meta-row"><div>Due Date</div><div>${esc(data.dueDateISO ?? "")}</div></div>
      <div class="meta-row"><div>Reference</div><div>${esc(data.reference ?? "")}</div></div>
    </div>
  </div>
</div>
<div class="billto">
  <h2>Bill To</h2>
  <div><strong>${esc(data.customerName)}</strong></div>
  <div>${esc(data.customerBillingAddress ?? "")}</div>
</div>
<div class="table-wrap">
  <table>
    <thead><tr><th style="width:48%">Description</th><th class="n" style="width:10%">Qty</th><th class="n" style="width:16%">Unit Price</th><th class="n" style="width:10%">Tax</th><th class="n" style="width:16%">Amount SGD</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
<div class="totals">
  <div><span>Subtotal</span><span>${money(data.subtotalCents, data.currency)}</span></div>
  <div><span>GST / local supply of goods and services ${data.taxRatePercent}%</span><span>${money(data.taxCents, data.currency)}</span></div>
  <div><strong>Invoice Total SGD</strong><strong>${money(data.totalCents, data.currency)}</strong></div>
  <div><span>Total Net Payments</span><span>${money(data.amountPaidCents, data.currency)}</span></div>
  <div class="due"><span>Amount Due SGD</span><span>${money(data.amountDueCents, data.currency)}</span></div>
</div>
<div style="margin-top:12px"><strong>Payment Instructions</strong><br/>${esc(data.paymentInstructions ?? "Please arrange payment by due date.")}</div>
<div class="page-break">
  <h2>Bank Transfer Details</h2>
  <div class="payment-grid">
    <div class="payment-card">
      <p>${esc(data.paymentInstructions ?? "Bank transfer / PayNow supported.")}</p>
      <p><strong>PayNow UEN:</strong> ${esc(data.sellerUen ?? "202606497W")}</p>
      <p class="muted">Please include invoice number in transfer reference.</p>
    </div>
    <div class="qr-card">
      <div class="qr-title">PayNow / SGQR</div>
      <div class="qr-sub">Scan to Pay<br/>UEN: ${esc(data.sellerUen ?? "202606497W")}</div>
      ${qrBlock}
    </div>
  </div>
  <p class="muted" style="margin-top:18px">Registered office and statutory footer information.</p>
</div>
</body></html>`;
}

export function renderInvoiceHtml(data: InvoiceRenderData): string {
  if (String(data.templateCode || "DB_WISDOM").toUpperCase() === "WISDOM_FORCE") {
    return renderWisdomForceInvoiceHtml(data);
  }
  return renderDbWisdomInvoiceHtml(data);
}

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { loadInvoiceAssetBuffer } from "../finance/invoice-render";

/** Packaged Noto Sans SC subset (OFL). Copied to dist via nest-cli finance assets. */
export const LORRY_CHIT_CJK_FONT_ASSET = "NotoSansSC-Regular.otf";

export type LorryChitCargoRow = {
  containerOrCargo: string;
  sizeOrPackage: string;
  remarks: string;
};

export type LorryChitPdfInput = {
  internalRef: string | null;
  externalRef: string | null;
  customerName: string | null;
  /** Trip/job date shown on the chit (local display string preferred). */
  dateLabel?: string | null;
  truckNumber?: string | null;
  vessel?: string | null;
  bookingRef?: string | null;
  shipper?: string | null;
  trailerNumber?: string | null;
  /** Prefer structured rows; falls back to a single summary row. */
  cargoRows?: LorryChitCargoRow[];
  containerSummary?: string | null;
  notes?: string | null;
  receiverName?: string | null;
  receiverNric?: string | null;
  signatureImageBytes?: Buffer | null;
  signedAt?: Date | null;
};

const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
const MARGIN = 28;
const BLACK = rgb(0, 0, 0);

/** Paper sample / approved Lorry Chit header (see NotoSansSC-NOTICE + sample PNG). */
export const LORRY_CHIT_COMPANY = {
  author: "WISDOM FORCE LOGISTICS PTE LTD",
  uen: "202005497W",
  contact: "+65 8335 0668",
} as const;

/** True when the string needs the packaged CJK font (not WinAnsi / Helvetica). */
export function textNeedsCjkFont(text: string): boolean {
  return /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(text);
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
) {
  if (!text) return;
  page.drawText(text, { x, y, size, font, color: BLACK });
}

/**
 * Prefer Helvetica for Latin/digits. The packaged Noto CJK subset has a broken
 * ASCII-digit cmap under pdf-lib embedding — drawing identifiers with CJK drops
 * or remaps digits (OOCU9212980 → OOCU). Use CJK only when ideographs are present.
 */
function drawAutoScriptText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  latinFont: PDFFont,
  cjkFont: PDFFont,
) {
  if (!text) return;
  drawText(page, text, x, y, size, textNeedsCjkFont(text) ? cjkFont : latinFont);
}

function drawUnderline(page: PDFPage, x: number, y: number, width: number) {
  page.drawLine({
    start: { x, y: y - 2 },
    end: { x: x + width, y: y - 2 },
    thickness: 0.8,
    color: BLACK,
  });
}

function fieldWithLine(
  page: PDFPage,
  label: string,
  value: string,
  x: number,
  y: number,
  labelFont: PDFFont,
  valueFont: PDFFont,
  labelSize: number,
  lineWidth: number,
) {
  drawText(page, label, x, y, labelSize, labelFont);
  const labelW = labelFont.widthOfTextAtSize(label, labelSize);
  const valueX = x + labelW + 6;
  const text = (value || "").trim();
  if (text) {
    // Never silently truncate container/truck identifiers.
    drawText(page, text, valueX, y, labelSize, valueFont);
  }
  drawUnderline(page, valueX, y, Math.max(40, lineWidth - labelW - 6));
}

/**
 * Landscape Lorry Chit matching the Wisdom Force paper sample layout.
 * Logo must resolve via loadInvoiceAssetBuffer("WF-logo.jpeg") — never silent omit.
 */
export async function buildLorryChitPdfBuffer(input: LorryChitPdfInput): Promise<Buffer> {
  const logoBytes = loadInvoiceAssetBuffer("WF-logo.jpeg");
  if (!logoBytes?.length) {
    throw new Error(
      'Lorry Chit logo asset missing: expected packaged file "WF-logo.jpeg" under src/transport/finance/assets (copied to dist on build).',
    );
  }

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle("LORRY CHIT");
  pdf.setAuthor(LORRY_CHIT_COMPANY.author);
  pdf.setSubject("Receiver acknowledgement");
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cjkBytes = loadInvoiceAssetBuffer(LORRY_CHIT_CJK_FONT_ASSET);
  if (!cjkBytes?.length) {
    throw new Error(
      `Lorry Chit CJK font missing: expected packaged file "${LORRY_CHIT_CJK_FONT_ASSET}" under src/transport/finance/assets (copied to dist on build). License: NotoSansSC-OFL.txt.`,
    );
  }
  const cjk = await pdf.embedFont(cjkBytes, { subset: true });

  let y = PAGE_H - MARGIN;

  const logoImg = await pdf.embedJpg(logoBytes);
  const logoW = 150;
  const logoH = (logoImg.height / logoImg.width) * logoW;
  page.drawImage(logoImg, {
    x: MARGIN,
    y: y - logoH,
    width: logoW,
    height: logoH,
  });

  // Approved WF logo already includes brand wordmark; only print UEN / contact under it.
  drawText(page, `UEN NO.: ${LORRY_CHIT_COMPANY.uen}`, MARGIN, y - logoH - 12, 9, font);
  drawText(
    page,
    `Contact No.: ${LORRY_CHIT_COMPANY.contact}`,
    MARGIN,
    y - logoH - 26,
    9,
    font,
  );

  const title = "LORRY CHIT";
  const titleSize = 22;
  const titleW = bold.widthOfTextAtSize(title, titleSize);
  drawText(page, title, (PAGE_W - titleW) / 2, y - 52, titleSize, bold);

  const rightColX = PAGE_W - MARGIN - 220;
  fieldWithLine(page, "Date:", input.dateLabel?.trim() || "", rightColX, y - 18, bold, font, 10, 200);
  {
    const labelSize = 10;
    const prefix = "Truck No.: (";
    const zh = "车牌";
    const suffix = ")";
    drawText(page, prefix, rightColX, y - 38, labelSize, bold);
    const prefixW = bold.widthOfTextAtSize(prefix, labelSize);
    drawText(page, zh, rightColX + prefixW, y - 38, labelSize, cjk);
    const zhW = cjk.widthOfTextAtSize(zh, labelSize);
    drawText(page, suffix, rightColX + prefixW + zhW, y - 38, labelSize, bold);
    const labelW = prefixW + zhW + bold.widthOfTextAtSize(suffix, labelSize);
    const valueX = rightColX + labelW + 6;
    const truck = input.truckNumber?.trim() || "";
    if (truck) {
      drawText(page, truck, valueX, y - 38, labelSize, font);
    }
    drawUnderline(page, valueX, y - 38, Math.max(40, 200 - labelW - 6));
  }

  y = Math.min(y - logoH, y - 90) - 16;

  const col1 = MARGIN;
  const col2 = PAGE_W / 2 + 10;
  const halfW = PAGE_W / 2 - MARGIN - 20;
  fieldWithLine(page, "Vessel:", input.vessel?.trim() || "", col1, y, bold, font, 10, halfW);
  fieldWithLine(
    page,
    "Booking Ref.:",
    (input.bookingRef ?? input.externalRef)?.trim() || "",
    col2,
    y,
    bold,
    font,
    10,
    halfW,
  );
  y -= 22;
  fieldWithLine(
    page,
    "Shipper:",
    (input.shipper ?? input.customerName)?.trim() || "",
    col1,
    y,
    bold,
    font,
    10,
    halfW,
  );
  fieldWithLine(
    page,
    "Trailer No.:",
    input.trailerNumber?.trim() || "",
    col2,
    y,
    bold,
    font,
    10,
    halfW,
  );
  y -= 18;

  const tableTop = y;
  const tableLeft = MARGIN;
  const tableRight = PAGE_W - MARGIN;
  const tableWidth = tableRight - tableLeft;
  const colSn = 36;
  const colSize = 110;
  const colRemarks = 130;
  const colCargo = tableWidth - colSn - colSize - colRemarks;
  const headerH = 28;
  const bodyH = 150;

  page.drawRectangle({
    x: tableLeft,
    y: tableTop - headerH - bodyH,
    width: tableWidth,
    height: headerH + bodyH,
    borderColor: BLACK,
    borderWidth: 1.2,
  });
  page.drawLine({
    start: { x: tableLeft, y: tableTop - headerH },
    end: { x: tableRight, y: tableTop - headerH },
    thickness: 1,
    color: BLACK,
  });
  let vx = tableLeft + colSn;
  for (const w of [colCargo, colSize]) {
    page.drawLine({
      start: { x: vx, y: tableTop },
      end: { x: vx, y: tableTop - headerH - bodyH },
      thickness: 1,
      color: BLACK,
    });
    vx += w;
  }
  page.drawLine({
    start: { x: tableLeft + colSn + colCargo + colSize, y: tableTop },
    end: { x: tableLeft + colSn + colCargo + colSize, y: tableTop - headerH - bodyH },
    thickness: 1,
    color: BLACK,
  });

  const headerY = tableTop - 12;
  drawText(page, "S/N", tableLeft + 8, headerY - 4, 9, bold);
  // English on first line (no trailing slash). Chinese on second line.
  drawText(page, "CONTAINER / CARGO DETAILS", tableLeft + colSn + 6, headerY, 8, bold);
  drawText(page, "集装箱 / 货物详情", tableLeft + colSn + 6, headerY - 11, 8, cjk);
  drawText(page, "SIZE / PACKAGE", tableLeft + colSn + colCargo + 8, headerY, 8, bold);
  drawText(page, "尺寸 / 包装", tableLeft + colSn + colCargo + 8, headerY - 11, 8, cjk);
  drawText(page, "REMARKS", tableLeft + colSn + colCargo + colSize + 8, headerY, 8, bold);
  drawText(page, "备注", tableLeft + colSn + colCargo + colSize + 8, headerY - 11, 8, cjk);

  const rows: LorryChitCargoRow[] =
    input.cargoRows && input.cargoRows.length > 0
      ? input.cargoRows
      : [
          {
            containerOrCargo: input.containerSummary?.trim() || "",
            sizeOrPackage: "",
            remarks: input.notes?.trim() || "",
          },
        ];

  let rowY = tableTop - headerH - 16;
  rows.slice(0, 6).forEach((row, idx) => {
    drawText(page, String(idx + 1), tableLeft + 12, rowY, 10, font);
    // Latin/digits via Helvetica — CJK subset corrupts ASCII digits under pdf-lib.
    drawAutoScriptText(
      page,
      row.containerOrCargo || "",
      tableLeft + colSn + 6,
      rowY,
      10,
      font,
      cjk,
    );
    drawAutoScriptText(
      page,
      row.sizeOrPackage || "",
      tableLeft + colSn + colCargo + 8,
      rowY,
      10,
      font,
      cjk,
    );
    drawAutoScriptText(
      page,
      row.remarks || "",
      tableLeft + colSn + colCargo + colSize + 8,
      rowY,
      10,
      font,
      cjk,
    );
    rowY -= 18;
  });

  y = tableTop - headerH - bodyH - 16;
  const ref =
    [input.externalRef?.trim(), input.internalRef?.trim()].filter(Boolean).join(" / ") || "-";
  drawText(page, `Reference: ${ref}`, MARGIN, y, 9, font);
  y -= 18;

  drawText(page, "Receiver acknowledgement", MARGIN, y, 11, bold);
  y -= 14;
  drawText(
    page,
    "I/We acknowledge receipt of the above stated goods in good order and condition.",
    MARGIN,
    y,
    9,
    font,
  );
  y -= 28;

  const sigLineW = 320;
  const stampLineW = 180;
  drawUnderline(page, MARGIN, y, sigLineW);
  drawUnderline(page, PAGE_W - MARGIN - stampLineW, y, stampLineW);

  if (input.signatureImageBytes?.length) {
    try {
      let sig;
      try {
        sig = await pdf.embedPng(input.signatureImageBytes);
      } catch {
        sig = await pdf.embedJpg(input.signatureImageBytes);
      }
      page.drawImage(sig, {
        x: MARGIN + 20,
        y: y - 8,
        width: 140,
        height: 48,
      });
    } catch {
      // signature embed is best-effort once logo requirement is satisfied
    }
  }

  const receiverLabel = [input.receiverName?.trim(), input.receiverNric?.trim()]
    .filter(Boolean)
    .join(" / ");
  if (receiverLabel) {
    drawText(page, receiverLabel.slice(0, 60), MARGIN + 4, y + 4, 10, font);
  }

  y -= 14;
  drawText(page, "Signature / Name / NRIC / FIN No.", MARGIN, y, 9, font);
  drawText(page, "Company Stamp", PAGE_W - MARGIN - stampLineW, y, 9, font);

  if (input.signedAt) {
    y -= 14;
    drawText(page, `Signed at: ${input.signedAt.toISOString()}`, MARGIN, y, 8, font);
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

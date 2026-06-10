export const DO_SIGNATURE_PDF_MAX_WIDTH_PT = 240;
export const DO_SIGNATURE_PDF_MAX_HEIGHT_PT = 70;
export const DO_SIGNATURE_LINE_GAP_PT = 4;
export const DO_SIGNATURE_DECLARATION_CLEARANCE_PT = 12;

export type DoSignatureImageDrawRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function computeDoSignatureImageDrawRect(input: {
  tableX: number;
  signLineY: number;
  declarationY: number;
  imageWidthPx: number;
  imageHeightPx: number;
}): DoSignatureImageDrawRect {
  const {
    tableX,
    signLineY,
    declarationY,
    imageWidthPx,
    imageHeightPx,
  } = input;

  const bottomY = signLineY + DO_SIGNATURE_LINE_GAP_PT;
  if (imageWidthPx <= 0 || imageHeightPx <= 0) {
    return { x: tableX, y: bottomY, width: 0, height: 0 };
  }

  const spaceAboveLine =
    declarationY
    - DO_SIGNATURE_DECLARATION_CLEARANCE_PT
    - signLineY
    - DO_SIGNATURE_LINE_GAP_PT;
  const maxHeight = Math.min(
    DO_SIGNATURE_PDF_MAX_HEIGHT_PT,
    Math.max(0, spaceAboveLine),
  );

  const widthRatio = DO_SIGNATURE_PDF_MAX_WIDTH_PT / imageWidthPx;
  const heightRatio = maxHeight / imageHeightPx;
  const scale = Math.min(widthRatio, heightRatio);

  return {
    x: tableX,
    y: bottomY,
    width: imageWidthPx * scale,
    height: imageHeightPx * scale,
  };
}

export function signatureImageTopY(rect: DoSignatureImageDrawRect): number {
  return rect.y + rect.height;
}

export function signatureImageOverlapsDeclaration(
  rect: DoSignatureImageDrawRect,
  declarationY: number,
): boolean {
  return signatureImageTopY(rect) > declarationY - DO_SIGNATURE_DECLARATION_CLEARANCE_PT;
}

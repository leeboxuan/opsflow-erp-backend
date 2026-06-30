import {
  DO_SIGNATURE_PDF_MAX_HEIGHT_PT,
  DO_SIGNATURE_PDF_MAX_WIDTH_PT,
  computeDoSignatureImageDrawRect,
  signatureImageOverlapsDeclaration,
} from "./signature-pdf-layout.helpers";

describe("computeDoSignatureImageDrawRect", () => {
  const tableX = 40;
  const declarationY = 200;
  const signLineY = declarationY - 56;

  it("caps signature size to 240pt x 70pt", () => {
    const rect = computeDoSignatureImageDrawRect({
      tableX,
      signLineY,
      declarationY,
      imageWidthPx: 1000,
      imageHeightPx: 400,
    });

    expect(rect.x).toBe(tableX);
    expect(rect.y).toBe(signLineY + 4);
    expect(rect.width).toBeLessThanOrEqual(DO_SIGNATURE_PDF_MAX_WIDTH_PT);
    expect(rect.height).toBeLessThanOrEqual(DO_SIGNATURE_PDF_MAX_HEIGHT_PT);
  });

  it("keeps signature above the line and below declaration text", () => {
    const rect = computeDoSignatureImageDrawRect({
      tableX,
      signLineY,
      declarationY,
      imageWidthPx: 480,
      imageHeightPx: 200,
    });

    expect(rect.y).toBeGreaterThan(signLineY);
    expect(signatureImageOverlapsDeclaration(rect, declarationY)).toBe(false);
  });

  it("aligns signature image x to the signature line left edge", () => {
    const rect = computeDoSignatureImageDrawRect({
      tableX,
      signLineY,
      declarationY,
      imageWidthPx: 120,
      imageHeightPx: 40,
    });

    expect(rect.x).toBe(tableX);
  });
});

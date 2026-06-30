import sharp from "sharp";

import {
  normalizeSignatureImageForPdf,
  pngBufferHasAlpha,
} from "./signature-image-normalize";

async function makeTransparentSignaturePng(): Promise<Buffer> {
  const stroke = await sharp({
    create: {
      width: 120,
      height: 40,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 100,
            height: 3,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 255 },
          },
        })
          .png()
          .toBuffer(),
        top: 18,
        left: 10,
      },
    ])
    .png()
    .toBuffer();

  return stroke;
}

describe("normalizeSignatureImageForPdf", () => {
  it("detects PNG alpha channel from IHDR color type", async () => {
    const transparentPng = await makeTransparentSignaturePng();
    expect(pngBufferHasAlpha(transparentPng)).toBe(true);
  });

  it("flattens transparent signature PNG onto white background", async () => {
    const transparentPng = await makeTransparentSignaturePng();
    const normalized = await normalizeSignatureImageForPdf(transparentPng);
    const meta = await sharp(normalized).metadata();

    expect(meta.hasAlpha).toBe(false);
    expect(meta.format).toBe("png");

    const { data, info } = await sharp(normalized)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const cornerIdx = 0;
    expect(data[cornerIdx]).toBe(255);
    expect(data[cornerIdx + 1]).toBe(255);
    expect(data[cornerIdx + 2]).toBe(255);
    expect(info.channels).toBe(3);
  });

  it("returns original buffer when sharp cannot process input", async () => {
    const invalid = Buffer.from("not-an-image");
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await normalizeSignatureImageForPdf(invalid);

    expect(result).toBe(invalid);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

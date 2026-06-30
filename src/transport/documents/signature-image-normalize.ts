import sharp from "sharp";

import { logDoSignatureDebug } from "./do-signature.helpers";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export function pngBufferHasAlpha(buffer: Buffer): boolean {
  if (buffer.length < 26 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return false;
  }
  const colorType = buffer[25];
  return colorType === 4 || colorType === 6;
}

export async function normalizeSignatureImageForPdf(
  signatureBuffer: Buffer,
): Promise<Buffer> {
  if (!signatureBuffer?.length) {
    return signatureBuffer;
  }

  try {
    const normalized = await sharp(signatureBuffer)
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();

    logDoSignatureDebug({
      phase: "normalize_signature_image",
      inputBytes: signatureBuffer.length,
      outputBytes: normalized.length,
      hadAlpha: pngBufferHasAlpha(signatureBuffer),
    });

    return normalized;
  } catch (error) {
    if (pngBufferHasAlpha(signatureBuffer)) {
      console.warn(
        "Signature PNG has alpha channel but could not be flattened; PDF may render transparent pixels as black. Ask mobile to send flattened white-background JPEG/PNG.",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
    return signatureBuffer;
  }
}

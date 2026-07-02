function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Builds a minimal valid single-page PDF without external PDF libraries.
 * Suitable for generated warehouse delivery orders / manifests.
 */
export function buildSimpleTextPdf(lines: string[]): Buffer {
  const fontSize = 10;
  let y = 800;
  const contentOps = lines
    .map((line) => {
      const op = `BT /F1 ${fontSize} Tf 40 ${y} Td (${escapePdfText(line)}) Tj ET`;
      y -= fontSize + 6;
      return op;
    })
    .join('\n');

  const streamBody = `${contentOps}\n`;
  const stream = `<< /Length ${Buffer.byteLength(streamBody, 'utf8')} >>\nstream\n${streamBody}endstream`;

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n${stream}\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += object;
  }

  const xrefOffset = Buffer.byteLength(body, 'utf8');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }

  body += `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body, 'utf8');
}

export type DeliveryOrderPdfInput = {
  internalRef: string;
  customerReference?: string | null;
  orderReference?: string | null;
  receivingVessel?: string | null;
  placeOfDelivery?: string | null;
  destinationCountry?: string | null;
  arrivalDate?: Date | null;
  departureDate?: Date | null;
  containerNumber?: string | null;
  sealNumber?: string | null;
  cargoLines: Array<{
    description: string;
    quantity: number;
    totalWeightKg?: unknown;
    lengthCm?: unknown;
    widthCm?: unknown;
    heightCm?: unknown;
    vesselName?: string | null;
    poNumber?: string | null;
  }>;
};

export function buildWarehouseDeliveryOrderPdf(input: DeliveryOrderPdfInput): Buffer {
  const lines: string[] = ['MANIFEST / DELIVERY ORDER', ''];
  lines.push(`Internal ref: ${input.internalRef}`);
  if (input.customerReference) lines.push(`Customer ref: ${input.customerReference}`);
  if (input.orderReference) lines.push(`Order reference: ${input.orderReference}`);
  if (input.receivingVessel) lines.push(`Receiving vessel: ${input.receivingVessel}`);
  if (input.placeOfDelivery) lines.push(`Place of delivery: ${input.placeOfDelivery}`);
  if (input.destinationCountry) lines.push(`Destination: ${input.destinationCountry}`);
  if (input.arrivalDate) {
    lines.push(`Arrival date: ${input.arrivalDate.toISOString().slice(0, 10)}`);
  }
  if (input.departureDate) {
    lines.push(`Departure date: ${input.departureDate.toISOString().slice(0, 10)}`);
  }
  if (input.containerNumber) lines.push(`Container: ${input.containerNumber}`);
  if (input.sealNumber) lines.push(`Seal: ${input.sealNumber}`);

  lines.push('', 'Cargo lines');
  if (!input.cargoLines.length) {
    lines.push('No cargo lines declared.');
  } else {
    input.cargoLines.forEach((line, index) => {
      const dims = [line.lengthCm, line.widthCm, line.heightCm]
        .filter((v) => v != null)
        .map((v) => String(v))
        .join(' x ');
      const weight = line.totalWeightKg != null ? `${line.totalWeightKg} kg` : '-';
      lines.push(
        `${index + 1}. ${line.description} | Qty ${line.quantity} | Wt ${weight}${
          dims ? ` | Dims ${dims} cm` : ''
        }${line.vesselName ? ` | Vessel ${line.vesselName}` : ''}${
          line.poNumber ? ` | PO ${line.poNumber}` : ''
        }`,
      );
    });
  }

  lines.push('', 'Receipt acknowledgement', 'Signature: __________________________');
  lines.push('Stamp: __________________________');
  lines.push('Time: __________________________');

  return buildSimpleTextPdf(lines);
}

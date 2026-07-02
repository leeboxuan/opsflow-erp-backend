import { buildSimpleTextPdf, buildWarehouseDeliveryOrderPdf } from './warehouse-job-delivery-order-pdf';

describe('warehouse-job-delivery-order-pdf', () => {
  it('builds a PDF buffer with PDF header', () => {
    const pdf = buildSimpleTextPdf(['MANIFEST / DELIVERY ORDER', 'Line 2']);
    const text = pdf.toString('utf8');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('MANIFEST / DELIVERY ORDER');
  });

  it('includes DO manifest fields and cargo lines', () => {
    const pdf = buildWarehouseDeliveryOrderPdf({
      internalRef: 'WH-2026-07-0001',
      customerReference: 'DB-MU 26KAT#1207',
      orderReference: '394-RW265015',
      receivingVessel: 'MV TEST',
      placeOfDelivery: 'Warehouse A',
      destinationCountry: 'Singapore',
      arrivalDate: new Date('2026-07-02T00:00:00.000Z'),
      cargoLines: [
        {
          description: 'Cartons',
          quantity: 10,
          totalWeightKg: 120.5,
          vesselName: 'MV TEST',
          poNumber: '394-RW265015',
        },
      ],
    });

    const text = pdf.toString('utf8');
    expect(text).toContain('DB-MU 26KAT#1207');
    expect(text).toContain('394-RW265015');
    expect(text).toContain('Cartons');
  });
});

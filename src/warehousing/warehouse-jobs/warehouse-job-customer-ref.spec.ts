import {
  formatWarehouseCustomerReference,
  resolveUserInitial,
  warehouseCustomerRefYear,
} from './warehouse-job-customer-ref';

describe('warehouse-job-customer-ref', () => {
  it('formats customer reference as DB-<creatorInitial> <YY><customerInitial>#<seq>', () => {
    expect(formatWarehouseCustomerReference('MU', '26', 'KAT', 1207)).toBe(
      'DB-MU 26KAT#1207',
    );
  });

  it('derives creator initial from display name', () => {
    expect(resolveUserInitial('Mary U', null, null)).toBe('MU');
    expect(resolveUserInitial(null, 'Mary U', null)).toBe('MU');
    expect(resolveUserInitial(null, null, 'mary.u@example.com')).toBe('MU');
  });

  it('uses two-digit UTC year', () => {
    expect(warehouseCustomerRefYear(new Date('2026-07-02T00:00:00.000Z'))).toBe(
      '26',
    );
  });
});

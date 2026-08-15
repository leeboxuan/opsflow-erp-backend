import { CanonicalTenantRole } from '@prisma/client';
import {
  canAccessDriverMobile,
  canAccessStaffWeb,
  isDriverMobileClientApp,
  isStaffWebClientApp,
  isTransportDriverOnly,
} from './access-surface';

describe('access-surface', () => {
  it('treats TRANSPORT_DRIVER-only (and legacy DRIVER) as driver-only', () => {
    expect(isTransportDriverOnly(['TRANSPORT_DRIVER'])).toBe(true);
    expect(isTransportDriverOnly(['DRIVER'])).toBe(true);
    expect(
      isTransportDriverOnly([
        CanonicalTenantRole.TRANSPORT_DRIVER,
        CanonicalTenantRole.TRANSPORT_ADMIN,
      ]),
    ).toBe(false);
    expect(isTransportDriverOnly(['TRANSPORT_ADMIN'])).toBe(false);
    expect(isTransportDriverOnly([])).toBe(false);
  });

  it('allows Driver Mobile only with explicit TRANSPORT_DRIVER', () => {
    expect(canAccessDriverMobile(['TRANSPORT_DRIVER'])).toBe(true);
    expect(canAccessDriverMobile(['DRIVER'])).toBe(true);
    expect(
      canAccessDriverMobile(['TRANSPORT_DRIVER', 'TRANSPORT_ADMIN']),
    ).toBe(true);
    expect(canAccessDriverMobile(['TRANSPORT_ADMIN'])).toBe(false);
    expect(canAccessDriverMobile(['TENANT_ADMIN'])).toBe(false);
    expect(canAccessDriverMobile(['FINANCE_ADMIN'])).toBe(false);
    expect(canAccessDriverMobile(['WAREHOUSE_STAFF'])).toBe(false);
    expect(canAccessDriverMobile(['CUSTOMER_ADMIN'])).toBe(false);
  });

  it('denies staff web for TRANSPORT_DRIVER-only', () => {
    expect(canAccessStaffWeb(['TRANSPORT_DRIVER'])).toBe(false);
    expect(canAccessStaffWeb(['DRIVER'])).toBe(false);
    expect(canAccessStaffWeb(['TRANSPORT_DRIVER', 'TRANSPORT_ADMIN'])).toBe(
      true,
    );
    expect(canAccessStaffWeb(['TRANSPORT_ADMIN'])).toBe(true);
    expect(canAccessStaffWeb(['TENANT_ADMIN'])).toBe(true);
  });

  it('classifies client apps without treating warehouse mobile as Driver Mobile', () => {
    expect(isDriverMobileClientApp('mobile')).toBe(true);
    expect(isDriverMobileClientApp('driver_mobile')).toBe(true);
    expect(isDriverMobileClientApp('warehouse_mobile')).toBe(false);
    expect(isStaffWebClientApp('web')).toBe(true);
    expect(isStaffWebClientApp('')).toBe(true);
    expect(isStaffWebClientApp('mobile')).toBe(false);
  });
});

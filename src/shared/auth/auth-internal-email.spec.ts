import {
  assertValidUsername,
  buildInternalAuthEmail,
  normalizeUsername,
} from './auth-internal-email';

describe('auth-internal-email', () => {
  it('normalizes username casing and whitespace', () => {
    expect(normalizeUsername('  Lee.Bo  ')).toBe('lee.bo');
    expect(normalizeUsername('Lee Bo')).toBe('leebo');
  });

  it('builds deterministic internal auth email', () => {
    expect(buildInternalAuthEmail('Acme-Co', 'lee.bo')).toBe(
      'acme-co.lee.bo@auth.opsflow.app',
    );
  });

  it('rejects invalid usernames', () => {
    expect(() => assertValidUsername('a')).toThrow();
    expect(() => assertValidUsername('.lee')).toThrow();
    expect(() => assertValidUsername('lee@x')).toThrow();
  });

  it('allows the same normalized username for different tenant slugs', () => {
    expect(buildInternalAuthEmail('tenant-a', 'floor1')).toBe(
      'tenant-a.floor1@auth.opsflow.app',
    );
    expect(buildInternalAuthEmail('tenant-b', 'floor1')).toBe(
      'tenant-b.floor1@auth.opsflow.app',
    );
  });
});

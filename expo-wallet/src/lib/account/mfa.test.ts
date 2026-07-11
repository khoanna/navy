import { mfaMethodLabel, isValidEnrollCode, otpauthSecretGroups, enrolledMfaMethods } from './mfa';
import type { User } from '@privy-io/expo';

describe('mfaMethodLabel', () => {
  it('maps known methods to labels', () => {
    expect(mfaMethodLabel('totp')).toBe('Authenticator app');
    expect(mfaMethodLabel('sms')).toBe('Text message');
    expect(mfaMethodLabel('passkey')).toBe('Passkey');
  });
  it('falls back to the raw method for unknown values', () => {
    expect(mfaMethodLabel('email')).toBe('email');
  });
});

describe('isValidEnrollCode', () => {
  it('accepts a 6-digit code', () => {
    expect(isValidEnrollCode('123456')).toBe(true);
  });
  it('rejects short, long, or non-numeric codes', () => {
    expect(isValidEnrollCode('12345')).toBe(false);
    expect(isValidEnrollCode('1234567')).toBe(false);
    expect(isValidEnrollCode('12a456')).toBe(false);
    expect(isValidEnrollCode('')).toBe(false);
  });
});

describe('otpauthSecretGroups', () => {
  it('splits a secret into space-separated groups of 4, uppercased', () => {
    expect(otpauthSecretGroups('abcd efgh')).toBe('ABCD EFGH');
    expect(otpauthSecretGroups('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
  });
  it('returns empty string for empty input', () => {
    expect(otpauthSecretGroups('')).toBe('');
  });
});

function userWithMfa(methods: string[]): User {
  return {
    id: 'did',
    created_at: 0,
    linked_accounts: [],
    mfa_methods: methods.map((type) => ({ type })),
  } as unknown as User;
}

describe('enrolledMfaMethods', () => {
  it('returns [] for a null user or no methods', () => {
    expect(enrolledMfaMethods(null)).toEqual([]);
    expect(enrolledMfaMethods(userWithMfa([]))).toEqual([]);
  });
  it('maps known mfa method types, dropping unknowns', () => {
    expect(enrolledMfaMethods(userWithMfa(['totp', 'passkey', 'sms', 'weird']))).toEqual([
      'totp',
      'passkey',
      'sms',
    ]);
  });
});

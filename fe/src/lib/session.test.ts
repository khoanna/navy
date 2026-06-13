import { ACCESS_COOKIE, REFRESH_COOKIE, decodeJwtRole } from './session';

function fakeJwt(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

describe('session helpers', () => {
  it('exposes stable cookie names', () => {
    expect(ACCESS_COOKIE).toBe('navy_access');
    expect(REFRESH_COOKIE).toBe('navy_refresh');
  });
  it('decodes the role from a Navy JWT payload', () => {
    expect(decodeJwtRole(fakeJwt({ sub: 'm1', role: 'merchant' }))).toBe('merchant');
    expect(decodeJwtRole(fakeJwt({ sub: 'ad1', role: 'admin' }))).toBe('admin');
  });
  it('returns null for a malformed token', () => {
    expect(decodeJwtRole('not-a-jwt')).toBeNull();
    expect(decodeJwtRole('')).toBeNull();
  });
  it('returns null when role claim is absent', () => {
    expect(decodeJwtRole(fakeJwt({ sub: 'x' }))).toBeNull();
  });
});

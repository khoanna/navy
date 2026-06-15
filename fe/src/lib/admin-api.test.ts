import { buildAuthHeaders } from './admin-api';

describe('buildAuthHeaders', () => {
  it('sets the Bearer authorization from a token', () => {
    expect(buildAuthHeaders('navy-jwt')).toEqual({ Authorization: 'Bearer navy-jwt', 'Content-Type': 'application/json' });
  });
  it('throws when there is no token', () => {
    expect(() => buildAuthHeaders(undefined)).toThrow(/unauthenticated/i);
  });
});

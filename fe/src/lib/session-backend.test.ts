import { buildAuthHeaders } from './session-backend';

describe('buildAuthHeaders', () => {
  it('sets Bearer from the session token', () => {
    expect(buildAuthHeaders('jwt')).toEqual({ Authorization: 'Bearer jwt', 'Content-Type': 'application/json' });
  });
  it('throws without a token', () => {
    expect(() => buildAuthHeaders(undefined)).toThrow(/unauthenticated/i);
  });
});

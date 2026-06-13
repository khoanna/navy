import { readServerEnv } from './env';

describe('readServerEnv', () => {
  it('returns the Navy API base url', () => {
    expect(readServerEnv({ NAVY_API_URL: 'http://api:3000' })).toEqual({ navyApiUrl: 'http://api:3000' });
  });
  it('throws when NAVY_API_URL is missing', () => {
    expect(() => readServerEnv({})).toThrow(/NAVY_API_URL/);
  });
});

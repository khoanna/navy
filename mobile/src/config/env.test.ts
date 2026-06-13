import { readEnv } from './env';

describe('readEnv', () => {
  it('maps expo extra into a typed config', () => {
    const cfg = readEnv({ privyAppId: 'app', privyClientId: 'client', navyApiUrl: 'http://x:3000' });
    expect(cfg).toEqual({ privyAppId: 'app', privyClientId: 'client', navyApiUrl: 'http://x:3000' });
  });

  it('throws when a required value is missing', () => {
    expect(() => readEnv({ privyAppId: '', privyClientId: 'c', navyApiUrl: 'u' })).toThrow(/privyAppId/);
  });
});

import { readEnv } from './env';

describe('readEnv', () => {
  const base = { privyAppId: 'app', privyClientId: 'client', navyApiUrl: 'http://x:3000',
                 baseRpc: 'https://base.example', usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                 chainId: '8453' };
  it('maps raw extra into a typed config', () => {
    expect(readEnv(base)).toEqual(base);
  });
  it('throws when a required value is missing', () => {
    expect(() => readEnv({ ...base, baseRpc: '' })).toThrow(/baseRpc/);
  });
});

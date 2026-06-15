import { readEnv } from './env';

describe('readEnv', () => {
  const base = { privyAppId: 'app', privyClientId: 'client', navyApiUrl: 'http://x:3000',
                 solanaRpc: 'https://api.devnet.solana.com', usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' };
  it('maps expo extra into a typed config', () => {
    expect(readEnv(base)).toEqual(base);
  });
  it('throws when a required value is missing', () => {
    expect(() => readEnv({ ...base, solanaRpc: '' })).toThrow(/solanaRpc/);
  });
});

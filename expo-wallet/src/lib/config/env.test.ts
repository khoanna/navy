import { readEnv } from './env';

describe('readEnv', () => {
  const base = { privyAppId: 'app', privyClientId: 'client', navyApiUrl: 'http://x:3000',
                 sepoliaRpc: 'https://sepolia.example', usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
                 chainId: '11155111' };
  it('maps raw extra into a typed config', () => {
    expect(readEnv(base)).toEqual(base);
  });
  it('throws when a required value is missing', () => {
    expect(() => readEnv({ ...base, sepoliaRpc: '' })).toThrow(/sepoliaRpc/);
  });
});

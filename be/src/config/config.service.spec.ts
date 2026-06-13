import { NavyConfigService } from './config.service';

describe('NavyConfigService', () => {
  const base = {
    NETWORK: 'devnet',
    SOLANA_RPC_DEVNET: 'https://api.devnet.solana.com',
    SOLANA_RPC_MAINNET: 'https://api.mainnet-beta.solana.com',
    NAVY_JWT_SECRET: 'x'.repeat(32),
    NAVY_JWT_ACCESS_TTL: '900',
    NAVY_JWT_REFRESH_TTL: '2592000',
    SUBWALLET_MASTER_KEY: '00'.repeat(32),
    PRIVY_APP_ID: 'app', PRIVY_APP_SECRET: 'secret',
    ADMIN_MAX_TOTP_FAILS: '5',
  };

  it('resolves the devnet RPC url from NETWORK', () => {
    const c = new NavyConfigService(base as any);
    expect(c.rpcUrl).toBe('https://api.devnet.solana.com');
    expect(c.network).toBe('devnet');
  });

  it('resolves the mainnet RPC url when NETWORK=mainnet', () => {
    const c = new NavyConfigService({ ...base, NETWORK: 'mainnet' } as any);
    expect(c.rpcUrl).toBe('https://api.mainnet-beta.solana.com');
  });

  it('throws if the master key is not 32 bytes hex', () => {
    expect(() => new NavyConfigService({ ...base, SUBWALLET_MASTER_KEY: 'abcd' } as any))
      .toThrow(/SUBWALLET_MASTER_KEY/);
  });
});

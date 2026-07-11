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

  it('parses relayerMinBalanceLamports from NAVY_RELAYER_MIN_BALANCE_SOL (SOL → lamports)', () => {
    const c = new NavyConfigService({ ...base, NAVY_RELAYER_MIN_BALANCE_SOL: '0.1' } as any);
    expect(c.relayerMinBalanceLamports).toBe(100_000_000);
  });

  it('defaults relayerMinBalanceLamports to 0.05 SOL when unset or NaN', () => {
    expect(new NavyConfigService(base as any).relayerMinBalanceLamports).toBe(50_000_000);
    expect(new NavyConfigService({ ...base, NAVY_RELAYER_MIN_BALANCE_SOL: 'nonsense' } as any).relayerMinBalanceLamports).toBe(50_000_000);
  });

  it('throws if the master key is not 32 bytes hex', () => {
    expect(() => new NavyConfigService({ ...base, SUBWALLET_MASTER_KEY: 'abcd' } as any))
      .toThrow(/SUBWALLET_MASTER_KEY/);
  });
});

const BASE = {
  SUBWALLET_MASTER_KEY: '11'.repeat(32),
  NETWORK: 'devnet',
  SOLANA_RPC_DEVNET: 'https://api.devnet.solana.com',
  NAVY_JWT_SECRET: 'x'.repeat(32),
  NAVY_JWT_ACCESS_TTL: '900',
  NAVY_JWT_REFRESH_TTL: '2592000',
  PRIVY_APP_ID: 'app',
  PRIVY_APP_SECRET: 'secret',
  ADMIN_MAX_TOTP_FAILS: '5',
} as NodeJS.ProcessEnv;

describe('NavyConfigService.privyAuthorizationKey', () => {
  it('is undefined when the env var is absent', () => {
    const cfg = new NavyConfigService({ ...BASE });
    expect(cfg.privyAuthorizationKey).toBeUndefined();
  });
  it('returns the key when present', () => {
    const cfg = new NavyConfigService({ ...BASE, PRIVY_AUTHORIZATION_KEY: 'wallet-auth-priv' });
    expect(cfg.privyAuthorizationKey).toBe('wallet-auth-priv');
  });
});

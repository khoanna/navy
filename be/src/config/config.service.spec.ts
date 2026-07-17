import { NavyConfigService } from './config.service';

describe('NavyConfigService', () => {
  const base = {
    NAVY_JWT_SECRET: 'x'.repeat(32),
    NAVY_JWT_ACCESS_TTL: '900',
    NAVY_JWT_REFRESH_TTL: '2592000',
    SUBWALLET_MASTER_KEY: '00'.repeat(32),
    PRIVY_APP_ID: 'app', PRIVY_APP_SECRET: 'secret',
    ADMIN_MAX_TOTP_FAILS: '5',
  };

  it('throws if the master key is not 32 bytes hex', () => {
    expect(() => new NavyConfigService({ ...base, SUBWALLET_MASTER_KEY: 'abcd' } as any))
      .toThrow(/SUBWALLET_MASTER_KEY/);
  });

  it('rejects a non-numeric ADMIN_MAX_TOTP_FAILS (NaN)', () => {
    const cfg = new NavyConfigService({ ...base, ADMIN_MAX_TOTP_FAILS: 'nope' } as any);
    expect(() => cfg.adminMaxTotpFails).toThrow(/ADMIN_MAX_TOTP_FAILS/);
  });

  it('rejects a non-positive ADMIN_MAX_TOTP_FAILS', () => {
    const cfg = new NavyConfigService({ ...base, ADMIN_MAX_TOTP_FAILS: '0' } as any);
    expect(() => cfg.adminMaxTotpFails).toThrow(/ADMIN_MAX_TOTP_FAILS/);
  });

  it('accepts a valid positive ADMIN_MAX_TOTP_FAILS', () => {
    const cfg = new NavyConfigService({ ...base, ADMIN_MAX_TOTP_FAILS: '5' } as any);
    expect(cfg.adminMaxTotpFails).toBe(5);
  });
});

const BASE = {
  SUBWALLET_MASTER_KEY: '11'.repeat(32),
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

describe('NavyConfigService EVM getters', () => {
  it('exposes EVM getters with sensible defaults', () => {
    const cfg = new NavyConfigService({
      ...BASE,
      SEPOLIA_RPC_URL: 'https://sepolia.example',
      NAVY_PAYMENTS_ADDRESS: '0x1111111111111111111111111111111111111111',
      NAVY_USDC_ADDRESS: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      NAVY_TREASURY_ADDRESS: '0x2222222222222222222222222222222222222222',
      NAVY_RELAYER_PRIVATE_KEY: '0x' + '1'.repeat(64),
      NAVY_OWNER_PRIVATE_KEY: '0x' + '2'.repeat(64),
    });
    expect(cfg.evmChainId).toBe(11155111);
    expect(cfg.usdcEip712Name).toBe('USDC');
    expect(cfg.usdcEip712Version).toBe('2');
    expect(cfg.relayerMinBalanceWei).toBe(20000000000000000n); // 0.02 ETH
  });
});

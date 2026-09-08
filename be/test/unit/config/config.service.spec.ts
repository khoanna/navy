import { NavyConfigService } from '../../../src/config/config.service';

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


describe('NavyConfigService EVM getters', () => {
  it('exposes EVM getters with sensible defaults', () => {
    const cfg = new NavyConfigService({
      ...BASE,
      BASE_RPC_URL: 'https://base.example',
      NAVY_PAYMENTS_ADDRESS: '0x1111111111111111111111111111111111111111',
      NAVY_USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      NAVY_TREASURY_ADDRESS: '0x2222222222222222222222222222222222222222',
      NAVY_RELAYER_PRIVATE_KEY: '0x' + '1'.repeat(64),
      NAVY_OWNER_PRIVATE_KEY: '0x' + '2'.repeat(64),
    });
    expect(cfg.evmChainId).toBe(8453);
    expect(cfg.usdcEip712Name).toBe('USD Coin'); // Default from Circle USDC on Base
    expect(cfg.usdcEip712Version).toBe('2');
    expect(cfg.relayerMinBalanceWei).toBe(20000000000000000n); // 0.02 ETH
  });
});

describe('vault share EIP-712 domain', () => {
  const base = {
    NAVY_JWT_SECRET: 'x'.repeat(32),
    NAVY_JWT_ACCESS_TTL: '900',
    NAVY_JWT_REFRESH_TTL: '2592000',
    SUBWALLET_MASTER_KEY: '00'.repeat(32),
    PRIVY_APP_ID: 'app', PRIVY_APP_SECRET: 'secret',
    ADMIN_MAX_TOTP_FAILS: '5',
  };

  // The name below is read from NavyVaultSRCLA's ERC20Permit constructor
  // (contract/src/NavyVaultSRCLA.sol). If the contract is ever renamed, this
  // test must fail -- an EIP-712 domain mismatch makes the vault reject every
  // redeem permit, and nothing else in the suite would notice.
  const CONTRACT_PERMIT_NAME = 'Navy Vault SRCLA';

  it('defaults to the name the deployed vault actually uses', () => {
    const cfg = new NavyConfigService({ ...base } as any);
    expect(cfg.vaultShareEip712Name).toBe(CONTRACT_PERMIT_NAME);
  });

  it('does not default to the retired NavyVaultSimple stub', () => {
    // This was the live default: with NAVY_VAULT_EIP712_NAME unset, permits were
    // signed against the test stub's domain and the real vault rejected them.
    const cfg = new NavyConfigService({ ...base } as any);
    expect(cfg.vaultShareEip712Name).not.toBe('Navy Vault Simple');
    expect(cfg.vaultShareEip712Name).not.toBe('Navy Vault USDC');
  });

  it('still lets the environment override it', () => {
    const cfg = new NavyConfigService({ ...base, NAVY_VAULT_EIP712_NAME: 'Custom' } as any);
    expect(cfg.vaultShareEip712Name).toBe('Custom');
  });
});

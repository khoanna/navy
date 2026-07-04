import { Injectable } from '@nestjs/common';

export type Network = 'devnet' | 'mainnet';

@Injectable()
export class NavyConfigService {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {
    if (!/^[0-9a-fA-F]{64}$/.test(this.req('SUBWALLET_MASTER_KEY'))) {
      throw new Error('SUBWALLET_MASTER_KEY must be 32 bytes (64 hex chars)');
    }
  }
  private req(k: string): string {
    const v = this.env[k];
    if (!v) throw new Error(`Missing required env var: ${k}`);
    return v;
  }
  get network(): Network { return this.req('NETWORK') as Network; }
  get rpcUrl(): string {
    return this.network === 'mainnet'
      ? this.req('SOLANA_RPC_MAINNET')
      : this.req('SOLANA_RPC_DEVNET');
  }
  get jwtSecret(): string { return this.req('NAVY_JWT_SECRET'); }
  get accessTtl(): number { return this.posIntTtl('NAVY_JWT_ACCESS_TTL'); }
  get refreshTtl(): number { return this.posIntTtl('NAVY_JWT_REFRESH_TTL'); }
  /** Parse a TTL (seconds) env var, rejecting NaN / non-positive values so tokens can't be minted non-expiring. */
  private posIntTtl(k: string): number {
    const n = parseInt(this.req(k), 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`${k} must be a positive integer (seconds); got "${this.env[k]}"`);
    }
    return n;
  }
  get masterKey(): Buffer { return Buffer.from(this.req('SUBWALLET_MASTER_KEY'), 'hex'); }
  get privyAppId(): string { return this.req('PRIVY_APP_ID'); }
  get privyAppSecret(): string { return this.req('PRIVY_APP_SECRET'); }
  get adminMaxTotpFails(): number { return parseInt(this.req('ADMIN_MAX_TOTP_FAILS'), 10); }
  /** Min relayer SOL balance (lamports) required before co-signing a payment. Env is SOL; default 0.05. */
  get relayerMinBalanceLamports(): number {
    const sol = parseFloat(this.env.NAVY_RELAYER_MIN_BALANCE_SOL ?? '0.05');
    return Math.floor((Number.isNaN(sol) ? 0.05 : sol) * 1e9);
  }
}

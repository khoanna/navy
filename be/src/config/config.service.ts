import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';

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
  get privyAuthorizationKey(): string | undefined { return this.env.PRIVY_AUTHORIZATION_KEY || undefined; }
  get adminMaxTotpFails(): number {
    const n = parseInt(this.req('ADMIN_MAX_TOTP_FAILS'), 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`ADMIN_MAX_TOTP_FAILS must be a positive integer; got "${this.env.ADMIN_MAX_TOTP_FAILS}"`);
    }
    return n;
  }
  /** How long an admin stays locked after hitting the TOTP fail limit. Env NAVY_ADMIN_LOCK_WINDOW_MS; default 15 min. */
  get adminLockWindowMs(): number {
    const n = parseInt(this.env.NAVY_ADMIN_LOCK_WINDOW_MS ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 15 * 60 * 1000;
  }
  // --- EVM (Sepolia) ---
  get evmRpcUrl(): string { return this.req('SEPOLIA_RPC_URL'); }
  get evmChainId(): number {
    const n = parseInt(this.env.EVM_CHAIN_ID ?? '11155111', 10);
    return Number.isFinite(n) ? n : 11155111;
  }
  get paymentsAddress(): string { return this.req('NAVY_PAYMENTS_ADDRESS'); }
  get usdcAddress(): string { return this.req('NAVY_USDC_ADDRESS'); }
  get treasuryAddress(): string { return this.req('NAVY_TREASURY_ADDRESS'); }
  get relayerPrivateKey(): string { return this.req('NAVY_RELAYER_PRIVATE_KEY'); }
  get ownerPrivateKey(): string { return this.req('NAVY_OWNER_PRIVATE_KEY'); }
  /** USDC EIP-712 domain name/version. Circle Sepolia USDC (EIP-3009) is name "USDC", version "2"; overridable + verify against chain. */
  get usdcEip712Name(): string { return this.env.NAVY_USDC_EIP712_NAME ?? 'USDC'; }
  get usdcEip712Version(): string { return this.env.NAVY_USDC_EIP712_VERSION ?? '2'; }
  /** Min relayer ETH balance (wei) required before submitting a payment. Env is ETH; default 0.02. */
  get relayerMinBalanceWei(): bigint {
    const eth = this.env.NAVY_RELAYER_MIN_BALANCE_ETH ?? '0.02';
    try { return ethers.parseEther(eth); } catch { return ethers.parseEther('0.02'); }
  }
  // --- OpenRouter (AI assistant) ---
  get openRouterApiKey(): string { return this.env.OPENROUTER_API_KEY ?? ''; }
  get openRouterModel(): string { return this.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash'; }
  get openRouterBaseUrl(): string { return this.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'; }
  get agentMaxIterations(): number { const n = parseInt(this.env.AGENT_MAX_ITERATIONS ?? '8', 10); return Number.isFinite(n) && n > 0 ? n : 8; }
  get agentContextTokenBudget(): number { const n = parseInt(this.env.AGENT_CONTEXT_TOKENS ?? '6000', 10); return Number.isFinite(n) && n > 0 ? n : 6000; }
  // --- CoinGecko (market data) ---
  get coinGeckoApiKey(): string { return this.env.COINGECKO_API_KEY ?? ''; }
  get coinGeckoBaseUrl(): string { return this.env.COINGECKO_BASE_URL ?? 'https://api.coingecko.com/api/v3'; }
}

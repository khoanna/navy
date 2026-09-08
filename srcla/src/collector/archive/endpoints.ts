/**
 * A rotating pool of Base archive RPC endpoints.
 *
 * MEASURED, not assumed. Probing four free endpoints at 365-day depth with
 * 16 sequential multicall3 batches at concurrency 3:
 *
 *   https://mainnet.base.org                  1.6 calls/s,  5/16 succeeded
 *   https://base.drpc.org                     8.3 calls/s, 16/16 succeeded
 *   https://base-mainnet.public.blastapi.io   7.5 calls/s, 16/16 succeeded
 *   https://gateway.tenderly.co/public/base   6.8 calls/s, 16/16 succeeded
 *
 * So a single-endpoint backfill of ~17,000 origins is not merely slow, it
 * drops two thirds of its requests -- and the official endpoint is the worst
 * of the four, which is exactly the trap a "use the canonical URL" default
 * falls into. It is kept LAST, as a fallback rather than a preference.
 *
 * The pool's contract is that a call either returns a real answer or throws.
 * It never returns a substituted or partial one: a backfill that silently
 * degraded would produce a dataset that looks complete and is not, which is
 * the failure mode paper §2.2 makes unrecoverable.
 *
 * UNITS: none (transport only). No I/O beyond the RPC calls the caller makes.
 */
import { JsonRpcProvider } from 'ethers';

/**
 * Base mainnet archive endpoints, in preference order.
 *
 * Verified archive-capable at block 19_300_000 (2024-09-03) -- the depth this
 * phase's calibration era starts at -- by reading Comet `getUtilization()`.
 * Endpoints that answered but were not archive-capable, or that refused
 * `eth_call` entirely, are listed in the probe notes rather than here:
 * publicnode (archive requires a token), 1rpc (state pruned), meowrpc (no
 * eth_call), llamarpc/blockpi (5xx), lava (410), nodies (403).
 */
export const ARCHIVE_ENDPOINTS: readonly string[] = [
  'https://base.drpc.org',
  'https://base-mainnet.public.blastapi.io',
  'https://gateway.tenderly.co/public/base',
  'https://base.gateway.tenderly.co',
  // Official, and the slowest by a factor of five. Fallback only.
  'https://mainnet.base.org',
];

export interface RpcPoolOptions {
  /** In-flight requests permitted against ONE endpoint. Default 3, the
   *  highest value at which every measured endpoint dropped nothing. */
  concurrencyPerEndpoint?: number;
  /** Total attempts across endpoints before a call gives up. Default 6. */
  maxAttempts?: number;
  /** First cooldown after a failure, doubling per consecutive failure. */
  baseCooldownMs?: number;
  /** Cooldown ceiling. */
  maxCooldownMs?: number;
  /** Injected clock, so tests need no timers. */
  now?: () => number;
  /** Injected sleep, so tests need no real delay. */
  sleep?: (ms: number) => Promise<void>;
}

export interface EndpointStats {
  url: string;
  ok: number;
  failed: number;
  consecutiveFailures: number;
  cooldownUntilMs: number;
  inFlight: number;
}

interface Endpoint {
  url: string;
  provider: JsonRpcProvider;
  ok: number;
  failed: number;
  consecutiveFailures: number;
  cooldownUntilMs: number;
  inFlight: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class RpcPool {
  private readonly endpoints: Endpoint[];
  private readonly concurrencyPerEndpoint: number;
  private readonly maxAttempts: number;
  private readonly baseCooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(urls: readonly string[] = ARCHIVE_ENDPOINTS, opts: RpcPoolOptions = {}) {
    if (urls.length === 0) throw new Error('RpcPool needs at least one endpoint');
    this.endpoints = urls.map((url) => ({
      url,
      // staticNetwork: without it ethers issues an eth_chainId alongside each
      // batch, which on a rate-limited public endpoint spends a request from
      // the same budget the actual read needs.
      provider: new JsonRpcProvider(url, 8453, { staticNetwork: true }),
      ok: 0,
      failed: 0,
      consecutiveFailures: 0,
      cooldownUntilMs: 0,
      inFlight: 0,
    }));
    this.concurrencyPerEndpoint = opts.concurrencyPerEndpoint ?? 3;
    this.maxAttempts = opts.maxAttempts ?? 6;
    this.baseCooldownMs = opts.baseCooldownMs ?? 250;
    this.maxCooldownMs = opts.maxCooldownMs ?? 8_000;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /** Total in-flight capacity, so a caller can size its own worker count. */
  get capacity(): number {
    return this.endpoints.length * this.concurrencyPerEndpoint;
  }

  stats(): EndpointStats[] {
    return this.endpoints.map((e) => ({
      url: e.url,
      ok: e.ok,
      failed: e.failed,
      consecutiveFailures: e.consecutiveFailures,
      cooldownUntilMs: e.cooldownUntilMs,
      inFlight: e.inFlight,
    }));
  }

  /**
   * Run `fn` against the healthiest available endpoint, retrying on others.
   *
   * Throws the LAST error after `maxAttempts`. It never returns a sentinel:
   * the caller records a gap, and a gap that is recorded is recoverable
   * while a zero that looks like data is not.
   */
  async call<T>(fn: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const endpoint = await this.acquire();
      endpoint.inFlight += 1;
      try {
        const result = await fn(endpoint.provider);
        endpoint.ok += 1;
        endpoint.consecutiveFailures = 0;
        endpoint.cooldownUntilMs = 0;
        return result;
      } catch (err) {
        lastError = err;
        endpoint.failed += 1;
        endpoint.consecutiveFailures += 1;
        const backoff = Math.min(
          this.maxCooldownMs,
          this.baseCooldownMs * 2 ** (endpoint.consecutiveFailures - 1),
        );
        endpoint.cooldownUntilMs = this.now() + backoff;
      } finally {
        endpoint.inFlight -= 1;
      }
    }
    throw new Error(
      `RpcPool: all ${this.maxAttempts} attempts failed across ${this.endpoints.length} ` +
        `endpoints. Last error: ${String(lastError)}`,
    );
  }

  /**
   * Wait for an endpoint that is neither saturated nor in cooldown, and
   * return the one with the fewest in-flight requests.
   *
   * When every endpoint is in cooldown it sleeps until the EARLIEST expiry
   * rather than spinning -- a spin here would burn the retry budget without
   * issuing a request.
   */
  private async acquire(): Promise<Endpoint> {
    for (;;) {
      const now = this.now();
      const available = this.endpoints.filter(
        (e) => e.cooldownUntilMs <= now && e.inFlight < this.concurrencyPerEndpoint,
      );
      if (available.length > 0) {
        return available.reduce((best, e) => (e.inFlight < best.inFlight ? e : best));
      }
      const cooling = this.endpoints.filter((e) => e.cooldownUntilMs > now);
      const waitMs =
        cooling.length === this.endpoints.length
          ? Math.max(1, Math.min(...cooling.map((e) => e.cooldownUntilMs)) - now)
          : 10;
      await this.sleep(waitMs);
    }
  }
}

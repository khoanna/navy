// The farming backend (be/src/farming) returns amounts as USDC base units (6 decimals).
// Wire keys: `amountBase` / `principalBase` / `currentValueBase` / `cTokenAmount` /
// `txSignature`. We match those keys exactly (values are 1e6 USDC base units).
export interface Position { address: string; principalBase: string; currentValueBase: string; cTokenAmount: string; }

/** Format USDC base units (6 decimals) to a plain decimal string.
 *  Uses integer arithmetic to avoid float precision loss on large amounts. */
export function formatUsdc(base: string | number): string {
  const n = BigInt(base);
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  if (frac === 0n) return whole.toString();
  // Zero-pad fractional part to 6 digits, then trim trailing zeros.
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

export class FarmingClient {
  /**
   * @param baseUrl       - Navy API base URL.
   * @param fetchImpl     - Underlying fetch (injected in tests; defaults to global fetch).
   * @param authedFetchFn - Optional pre-wired authed fetch returned by `makeAuthedFetch`.
   *                        When provided, all farming endpoints (which are all authenticated)
   *                        route through it so the Navy access token is auto-refreshed on 401.
   */
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly authedFetchFn?: (url: string, init?: RequestInit) => Promise<Response>,
  ) {}

  private h(token: string) { return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }; }

  private async json<T>(path: string, token: string, init?: RequestInit): Promise<T> {
    if (this.authedFetchFn) {
      // authedFetchFn injects Authorization; pass Content-Type + body via init.
      // Merge caller headers (minus any Authorization already present).
      const { Authorization: _a, authorization: _b, ...restHeaders } =
        (init?.headers as Record<string, string> | undefined) ?? {};
      const res = await this.authedFetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...restHeaders },
      });
      if (!res.ok) throw new Error(`farming ${path} failed (${res.status})`);
      return (await res.json()) as T;
    }
    // Legacy path: inject the bearer token directly (test / no-refresh path).
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers: { ...this.h(token), ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`farming ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }

  createSubwallet(token: string): Promise<{ subwalletId: string; address: string }> { return this.json('/farming/subwallet', token, { method: 'POST' }); }
  getPosition(token: string): Promise<Position> { return this.json('/farming', token); }
  deposit(token: string, amountBase: string): Promise<{ txSignature: string }> { return this.json('/farming/deposit', token, { method: 'POST', body: JSON.stringify({ amountBase }) }); }
  withdraw(token: string, amount: 'all' | string): Promise<{ txSignature: string }> { return this.json('/farming/withdraw', token, { method: 'POST', body: JSON.stringify({ amount }) }); }
  history(token: string): Promise<any[]> { return this.json('/farming/history', token); }
  getDelegation(token: string): Promise<{ available: boolean; enabled: boolean }> { return this.json('/farming/delegation', token); }
  enableDelegation(token: string): Promise<{ available: boolean; enabled: boolean }> { return this.json('/farming/delegation', token, { method: 'POST' }); }
  disableDelegation(token: string): Promise<{ available: boolean; enabled: boolean }> { return this.json('/farming/delegation', token, { method: 'DELETE' }); }
  fundNow(token: string): Promise<{ txSignature: string } | { skipped: string }> { return this.json('/farming/fund-now', token, { method: 'POST' }); }
}

// The farming backend (be/src/farming) kept its Solana-era wire field names after the
// EVM migration — the amounts are now USDC base units (6 decimals), but the JSON keys are
// still `amountLamports` / `principalLamports` / `currentValueLamports` / `cTokenAmount` /
// `txSignature`. We match those keys exactly and only change the *interpretation* (1e6, USDC).
export interface Position { address: string; principalLamports: string; currentValueLamports: string; cTokenAmount: string; }

/** Format USDC base units (6 decimals) to a plain decimal string. */
export function formatUsdc(base: string | number): string {
  return (Number(base) / 1_000_000).toString();
}

export class FarmingClient {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}
  private h(token: string) { return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }; }
  private async json<T>(path: string, token: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers: { ...this.h(token), ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`farming ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }
  createSubwallet(token: string): Promise<{ subwalletId: string; address: string }> { return this.json('/farming/subwallet', token, { method: 'POST' }); }
  getPosition(token: string): Promise<Position> { return this.json('/farming', token); }
  deposit(token: string, amountBase: string): Promise<{ txSignature: string }> { return this.json('/farming/deposit', token, { method: 'POST', body: JSON.stringify({ amountLamports: amountBase }) }); }
  withdraw(token: string, amount: 'all' | string): Promise<{ txSignature: string }> { return this.json('/farming/withdraw', token, { method: 'POST', body: JSON.stringify({ amount }) }); }
  history(token: string): Promise<any[]> { return this.json('/farming/history', token); }
  getDelegation(token: string): Promise<{ available: boolean; enabled: boolean }> { return this.json('/farming/delegation', token); }
  enableDelegation(token: string): Promise<{ available: boolean; enabled: boolean }> { return this.json('/farming/delegation', token, { method: 'POST' }); }
  disableDelegation(token: string): Promise<{ available: boolean; enabled: boolean }> { return this.json('/farming/delegation', token, { method: 'DELETE' }); }
  fundNow(token: string): Promise<{ txSignature: string } | { skipped: string }> { return this.json('/farming/fund-now', token, { method: 'POST' }); }
}

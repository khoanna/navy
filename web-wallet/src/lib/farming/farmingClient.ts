export interface Position { address: string; principalLamports: string; currentValueLamports: string; cTokenAmount: string; }

export function formatSol(lamports: string | number): string {
  return (Number(lamports) / 1_000_000_000).toString();
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
  deposit(token: string, amountLamports: string): Promise<{ txSignature: string }> { return this.json('/farming/deposit', token, { method: 'POST', body: JSON.stringify({ amountLamports }) }); }
  withdraw(token: string, amount: 'all' | string): Promise<{ txSignature: string }> { return this.json('/farming/withdraw', token, { method: 'POST', body: JSON.stringify({ amount }) }); }
  history(token: string): Promise<any[]> { return this.json('/farming/history', token); }
}

/** Static shortcuts so common tokens skip the /search call (saves a monthly-capped request). */
export const KNOWN_TOKEN_IDS: Record<string, string> = {
  eth: 'ethereum', ethereum: 'ethereum', weth: 'weth',
  btc: 'bitcoin', bitcoin: 'bitcoin', wbtc: 'wrapped-bitcoin',
  usdc: 'usd-coin', 'usd-coin': 'usd-coin', usdt: 'tether', tether: 'tether',
  sol: 'solana', solana: 'solana', bnb: 'binancecoin',
};

/** Resolve a query to a known coin id, or null (caller then uses /search). */
export function resolveKnownTokenId(query: string): string | null {
  const q = (query ?? '').trim().toLowerCase();
  return KNOWN_TOKEN_IDS[q] ?? null;
}

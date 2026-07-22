export interface PriceDto { id: string; priceUsd: number; change24h: number | null; marketCapUsd: number | null }
export interface TokenInfoDto {
  id: string; symbol: string; name: string; priceUsd: number | null;
  change24h: number | null; change7d: number | null; change30d: number | null;
  marketCapUsd: number | null; rank: number | null; volume24h: number | null;
  ath: number | null; athChangePct: number | null; atl: number | null;
  circulatingSupply: number | null; totalSupply: number | null; maxSupply: number | null;
  description: string; homepage: string | null; sparkline7d: number[];
}
export interface TopCoinDto { id: string; symbol: string; name: string; priceUsd: number | null; marketCapUsd: number | null; rank: number | null; change24h: number | null }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function normalizePrice(id: string, json: any): PriceDto | null {
  const row = json?.[id];
  if (!row || typeof row.usd !== 'number') return null;
  return { id, priceUsd: row.usd, change24h: num(row.usd_24h_change), marketCapUsd: num(row.usd_market_cap) };
}

export function normalizeTokenInfo(json: any): TokenInfoDto {
  const md = json?.market_data ?? {};
  const firstHomepage = (json?.links?.homepage ?? []).find((h: string) => h && h.length > 0) ?? null;
  const desc = (json?.description?.en ?? '').trim();
  return {
    id: json?.id ?? '', symbol: (json?.symbol ?? '').toUpperCase(), name: json?.name ?? '',
    priceUsd: num(md.current_price?.usd),
    change24h: num(md.price_change_percentage_24h), change7d: num(md.price_change_percentage_7d), change30d: num(md.price_change_percentage_30d),
    marketCapUsd: num(md.market_cap?.usd), rank: num(json?.market_cap_rank), volume24h: num(md.total_volume?.usd),
    ath: num(md.ath?.usd), athChangePct: num(md.ath_change_percentage?.usd), atl: num(md.atl?.usd),
    circulatingSupply: num(md.circulating_supply), totalSupply: num(md.total_supply), maxSupply: num(md.max_supply),
    description: desc.length > 600 ? desc.slice(0, 600) + '…' : desc,
    homepage: firstHomepage,
    sparkline7d: Array.isArray(md.sparkline_7d?.price) ? md.sparkline_7d.price.filter((x: unknown) => typeof x === 'number') : [],
  };
}

export function normalizeTopCoins(arr: any[]): TopCoinDto[] {
  return (arr ?? []).map((c) => ({
    id: c.id, symbol: (c.symbol ?? '').toUpperCase(), name: c.name,
    priceUsd: num(c.current_price), marketCapUsd: num(c.market_cap), rank: num(c.market_cap_rank), change24h: num(c.price_change_percentage_24h),
  }));
}

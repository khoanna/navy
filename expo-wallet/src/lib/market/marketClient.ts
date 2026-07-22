export interface PriceDto { id: string; priceUsd: number; change24h: number | null; marketCapUsd: number | null }

export class MarketClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authedFetch: (url: string, init?: RequestInit) => Promise<Response>,
  ) {}
  async getPrices(ids: string[]): Promise<Record<string, PriceDto>> {
    const res = await this.authedFetch(`${this.baseUrl}/market/prices?ids=${encodeURIComponent(ids.join(','))}`);
    if (!res.ok) throw new Error(`market/prices failed (${res.status})`);
    return (await res.json()) as Record<string, PriceDto>;
  }
}

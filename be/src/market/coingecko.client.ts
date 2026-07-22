export interface CoinGeckoConfig { apiKey: string; baseUrl: string }

export class CoinGeckoClient {
  constructor(private readonly cfg: CoinGeckoConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  private async get(path: string): Promise<any> {
    if (!this.cfg.apiKey) throw new Error('CoinGecko API key not configured');
    const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
      headers: { accept: 'application/json', 'x-cg-demo-api-key': this.cfg.apiKey },
    });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  simplePrice(ids: string[]): Promise<any> {
    const q = encodeURIComponent(ids.join(','));
    return this.get(`/simple/price?ids=${q}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`);
  }
  search(query: string): Promise<any> { return this.get(`/search?query=${encodeURIComponent(query)}`); }
  coin(id: string): Promise<any> {
    return this.get(`/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=true`);
  }
  topCoins(perPage: number): Promise<any> {
    return this.get(`/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=false&price_change_percentage=24h`);
  }
}

import { Injectable } from '@nestjs/common';
import { NavyConfigService } from '../config/config.service';
import { CoinGeckoClient } from './coingecko.client';
import { TtlCache } from './ttl-cache';
import { resolveKnownTokenId } from './resolve-token-id';
import { normalizePrice, normalizeTokenInfo, normalizeTopCoins, type PriceDto, type TokenInfoDto, type TopCoinDto } from './coingecko-normalize';

const PRICE_TTL = 60_000;
const SEARCH_TTL = 24 * 60 * 60_000;
const TOP_TTL = 60_000;

@Injectable()
export class PriceService {
  private readonly client: CoinGeckoClient;
  private readonly cache = new TtlCache();
  constructor(private readonly cfg: NavyConfigService) {
    this.client = new CoinGeckoClient({ apiKey: cfg.coinGeckoApiKey, baseUrl: cfg.coinGeckoBaseUrl });
  }

  async prices(ids: string[]): Promise<Record<string, PriceDto>> {
    const out: Record<string, PriceDto> = {};
    const missing: string[] = [];
    for (const id of ids) {
      const hit = this.cache.peek<PriceDto>(`price:${id}`);
      if (hit) out[id] = hit; else missing.push(id);
    }
    if (missing.length) {
      const batchKey = 'pricebatch:' + [...missing].sort().join(',');
      const fetched = await this.cache.getOrLoad<Record<string, PriceDto>>(batchKey, PRICE_TTL, async () => {
        const json = await this.client.simplePrice(missing);          // ONE upstream call for all missing ids
        const map: Record<string, PriceDto> = {};
        for (const id of missing) {
          const dto = normalizePrice(id, json);
          if (dto) { this.cache.set(`price:${id}`, PRICE_TTL, dto); map[id] = dto; }
        }
        return map;
      });
      Object.assign(out, fetched);
    }
    return out;
  }

  async ethUsd(): Promise<number | null> {
    const p = await this.prices(['ethereum']);
    return p['ethereum']?.priceUsd ?? null;
  }

  private async resolveId(query: string): Promise<string | null> {
    const known = resolveKnownTokenId(query);
    if (known) return known;
    return this.cache.getOrLoad(`search:${query.trim().toLowerCase()}`, SEARCH_TTL, async () => {
      const res = await this.client.search(query);
      return res?.coins?.[0]?.id ?? null;
    });
  }

  async tokenInfo(query: string): Promise<TokenInfoDto | null> {
    const id = await this.resolveId(query);
    if (!id) return null;
    return this.cache.getOrLoad(`coin:${id}`, PRICE_TTL, async () => normalizeTokenInfo(await this.client.coin(id)));
  }

  async topCoins(limit = 10): Promise<TopCoinDto[]> {
    const n = Math.max(1, Math.min(limit, 50));
    return this.cache.getOrLoad(`top:${n}`, TOP_TTL, async () => normalizeTopCoins(await this.client.topCoins(n)));
  }
}

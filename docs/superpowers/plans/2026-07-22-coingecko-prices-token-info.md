# CoinGecko Prices & Token Info Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CoinGecko-backed market data so the app shows portfolio value in USD and the assistant can analyze any token, with a demand-driven cache that stays inside the free tier.

**Architecture:** A new `be/src/market` module wraps CoinGecko (native `fetch`) behind a pure TTL+coalescing cache; `PriceService` exposes `ethUsd`/`tokenInfo`/`topCoins` used by a `MarketController` (app) and by the agent tools. USDC=$1; ETH valued via `/simple/price`; rich token info via `/search`→`/coins/{id}`; top coins via `/coins/markets`.

**Tech Stack:** Nest.js 11, native fetch, Jest; Expo/React Native (react-native-svg). CoinGecko demo API (`x-cg-demo-api-key`, base `https://api.coingecko.com/api/v3`).

**Builds on branch `feat/ai-assistant`** (existing: `be/src/agent` tools + `agent-tools.service.ts` `get_portfolio`, `NavyConfigService`, `expo-wallet` Home + `ChartCard`).

---

## Prerequisites

- `be/` Postgres up; `COINGECKO_API_KEY=<demo key>` will be added to `be/.env` (Task A6 / verification).
- CoinGecko facts: base `https://api.coingecko.com/api/v3`, header `x-cg-demo-api-key`, 10k calls/month cap → demand-driven only, 60s price TTL, 24h search TTL, coalesce concurrent identical calls.

## File Structure

**Backend (create) — `be/src/market/`:**
- `ttl-cache.ts` (+spec) — pure TTL cache with in-flight coalescing + serve-stale-on-error.
- `coingecko-normalize.ts` (+spec) — pure DTO shapers.
- `resolve-token-id.ts` (+spec) — pure static symbol→id map.
- `coingecko.client.ts` — fetch wrapper (typecheck).
- `price.service.ts` — compose client+cache+normalize (typecheck).
- `market.controller.ts`, `market.module.ts` — REST + wiring.

**Backend (modify):**
- `be/src/config/config.service.ts` — CoinGecko config getters.
- `be/src/app.module.ts` — register `MarketModule`.
- `be/src/agent/tool-schemas.ts` — `get_token_info`, `get_top_coins`.
- `be/src/agent/agent-tools.service.ts` — new handlers + `get_portfolio` USD enrichment.
- `be/src/agent/agent.module.ts` + `agent-tools.service.ts` — inject `PriceService`.
- `be/src/agent/agent.service.ts` — system-prompt "analyze, not dump" line.
- `be/scripts/coingecko-smoke.mjs` (create) — live key smoke.

**Expo (create):**
- `src/lib/market/marketClient.ts` (+test) — `getPrices`.
- `src/features/assistant/TokenInfoCard.tsx` — token card w/ sparkline.

**Expo (modify):**
- `app/(tabs)/home.tsx` — portfolio USD.
- `app/(tabs)/assistant.tsx` — render `kind:'token'` + top-coins.

---

## Phase A — Backend market module

### Task A1: Config getters + `TtlCache`

**Files:** Modify `be/src/config/config.service.ts`; Create `be/src/market/ttl-cache.ts` (+ `ttl-cache.spec.ts`)

- [ ] **Step 1: Add config getters** (non-throwing key so the app boots without it) at the end of `NavyConfigService`:

```ts
  // --- CoinGecko (market data) ---
  get coinGeckoApiKey(): string { return this.env.COINGECKO_API_KEY ?? ''; }
  get coinGeckoBaseUrl(): string { return this.env.COINGECKO_BASE_URL ?? 'https://api.coingecko.com/api/v3'; }
```

- [ ] **Step 2: Write the failing test** `be/src/market/ttl-cache.spec.ts`:

```ts
import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('caches within ttl and reloads after expiry (injected clock)', async () => {
    let t = 1000, calls = 0;
    const cache = new TtlCache({ now: () => t });
    const loader = async () => { calls++; return calls; };
    expect(await cache.getOrLoad('k', 100, loader)).toBe(1);
    t = 1050; expect(await cache.getOrLoad('k', 100, loader)).toBe(1); // still fresh
    t = 1200; expect(await cache.getOrLoad('k', 100, loader)).toBe(2); // expired -> reload
  });
  it('coalesces concurrent loads into a single loader call', async () => {
    let calls = 0;
    const cache = new TtlCache();
    const loader = () => new Promise<number>((res) => { calls++; setTimeout(() => res(42), 5); });
    const out = await Promise.all([cache.getOrLoad('k', 1000, loader), cache.getOrLoad('k', 1000, loader), cache.getOrLoad('k', 1000, loader)]);
    expect(out).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
  });
  it('serves the stale value when the loader throws after a prior success', async () => {
    let t = 1000, mode = 'ok';
    const cache = new TtlCache({ now: () => t });
    const loader = async () => { if (mode === 'fail') throw new Error('boom'); return 'v1'; };
    expect(await cache.getOrLoad('k', 100, loader)).toBe('v1');
    t = 1200; mode = 'fail';
    expect(await cache.getOrLoad('k', 100, loader)).toBe('v1'); // stale served, no throw
  });
  it('throws when the loader fails and there is no prior value', async () => {
    const cache = new TtlCache();
    await expect(cache.getOrLoad('k', 100, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 3: Run** `cd be && pnpm test ttl-cache.spec` → FAIL.

- [ ] **Step 4: Implement** `be/src/market/ttl-cache.ts`:

```ts
export interface TtlCacheOptions { now?: () => number }

/** In-memory TTL cache with in-flight coalescing + serve-stale-on-error. Single-instance (devnet). */
export class TtlCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();
  private inflight = new Map<string, Promise<unknown>>();
  private readonly now: () => number;
  constructor(opts: TtlCacheOptions = {}) { this.now = opts.now ?? (() => Date.now()); }

  async getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = this.store.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value as T;

    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const p = (async () => {
      try {
        const value = await loader();
        this.store.set(key, { value, expiresAt: this.now() + ttlMs });
        return value;
      } catch (e) {
        const stale = this.store.get(key);
        if (stale) return stale.value as T; // serve-stale-on-error
        throw e;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p as Promise<T>;
  }
}
```

- [ ] **Step 5: Run** → PASS.

- [ ] **Step 6: Commit**

```bash
git add be/src/config/config.service.ts be/src/market/ttl-cache.ts be/src/market/ttl-cache.spec.ts
git commit -m "feat(be): CoinGecko config + TtlCache (coalescing, serve-stale)"
```

### Task A2: `coingecko-normalize` (pure DTO shapers)

**Files:** Create `be/src/market/coingecko-normalize.ts` (+ `.spec.ts`)

- [ ] **Step 1: Write the failing test**

```ts
import { normalizePrice, normalizeTokenInfo, normalizeTopCoins } from './coingecko-normalize';

describe('coingecko-normalize', () => {
  it('normalizePrice reads /simple/price shape', () => {
    const json = { ethereum: { usd: 3200.5, usd_market_cap: 3.8e11, usd_24h_change: 2.34 } };
    expect(normalizePrice('ethereum', json)).toEqual({ id: 'ethereum', priceUsd: 3200.5, change24h: 2.34, marketCapUsd: 3.8e11 });
  });
  it('normalizePrice returns null when the id is missing', () => {
    expect(normalizePrice('ethereum', {})).toBeNull();
  });
  it('normalizeTokenInfo reads /coins/{id} shape', () => {
    const json = {
      id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1,
      description: { en: 'Bitcoin is a decentralized...' },
      links: { homepage: ['https://bitcoin.org', ''] },
      market_data: {
        current_price: { usd: 67240 }, price_change_percentage_24h: 2.3,
        price_change_percentage_7d: 5.1, price_change_percentage_30d: -3.2,
        market_cap: { usd: 1.32e12 }, total_volume: { usd: 3.1e10 },
        ath: { usd: 73000 }, ath_change_percentage: { usd: -7.9 }, atl: { usd: 67 },
        circulating_supply: 19700000, total_supply: 21000000, max_supply: 21000000,
        sparkline_7d: { price: [66000, 66500, 67000, 67240] },
      },
    };
    const dto = normalizeTokenInfo(json);
    expect(dto.id).toBe('bitcoin');
    expect(dto.symbol).toBe('BTC');
    expect(dto.priceUsd).toBe(67240);
    expect(dto.rank).toBe(1);
    expect(dto.change7d).toBe(5.1);
    expect(dto.marketCapUsd).toBe(1.32e12);
    expect(dto.homepage).toBe('https://bitcoin.org');
    expect(dto.sparkline7d).toEqual([66000, 66500, 67000, 67240]);
    expect(dto.description.startsWith('Bitcoin is')).toBe(true);
  });
  it('normalizeTopCoins maps the /coins/markets array', () => {
    const arr = [{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 67240, market_cap: 1.3e12, market_cap_rank: 1, price_change_percentage_24h: 2.3 }];
    expect(normalizeTopCoins(arr)).toEqual([{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', priceUsd: 67240, marketCapUsd: 1.3e12, rank: 1, change24h: 2.3 }]);
  });
});
```

- [ ] **Step 2: Run** `cd be && pnpm test coingecko-normalize.spec` → FAIL.

- [ ] **Step 3: Implement**

```ts
// be/src/market/coingecko-normalize.ts
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
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/market/coingecko-normalize.ts be/src/market/coingecko-normalize.spec.ts
git commit -m "feat(be): pure CoinGecko response normalizers"
```

### Task A3: `resolveTokenId` (static symbol→id map)

**Files:** Create `be/src/market/resolve-token-id.ts` (+ `.spec.ts`)

- [ ] **Step 1: Write the failing test**

```ts
import { resolveKnownTokenId, KNOWN_TOKEN_IDS } from './resolve-token-id';

describe('resolveKnownTokenId', () => {
  it('maps common symbols/names case-insensitively', () => {
    expect(resolveKnownTokenId('ETH')).toBe('ethereum');
    expect(resolveKnownTokenId(' eth ')).toBe('ethereum');
    expect(resolveKnownTokenId('btc')).toBe('bitcoin');
    expect(resolveKnownTokenId('USDC')).toBe('usd-coin');
    expect(resolveKnownTokenId('ethereum')).toBe('ethereum');
  });
  it('returns null for unknown queries (caller falls back to /search)', () => {
    expect(resolveKnownTokenId('somerandomcoin')).toBeNull();
  });
  it('KNOWN_TOKEN_IDS includes the wallet assets', () => {
    expect(KNOWN_TOKEN_IDS.eth).toBe('ethereum');
    expect(KNOWN_TOKEN_IDS.usdc).toBe('usd-coin');
  });
});
```

- [ ] **Step 2: Run** `cd be && pnpm test resolve-token-id.spec` → FAIL.

- [ ] **Step 3: Implement**

```ts
// be/src/market/resolve-token-id.ts
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
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/market/resolve-token-id.ts be/src/market/resolve-token-id.spec.ts
git commit -m "feat(be): static token-id resolver"
```

### Task A4: `CoinGeckoClient`

**Files:** Create `be/src/market/coingecko.client.ts`

- [ ] **Step 1: Implement** (typecheck-only; network I/O):

```ts
// be/src/market/coingecko.client.ts
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
  search(query: string): Promise<any> {
    return this.get(`/search?query=${encodeURIComponent(query)}`);
  }
  coin(id: string): Promise<any> {
    return this.get(`/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=true`);
  }
  topCoins(perPage: number): Promise<any> {
    return this.get(`/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=false&price_change_percentage=24h`);
  }
}
```

- [ ] **Step 2: Typecheck** `cd be && pnpm build` → clean.

- [ ] **Step 3: Commit**

```bash
git add be/src/market/coingecko.client.ts
git commit -m "feat(be): CoinGecko HTTP client"
```

### Task A5: `PriceService`

**Files:** Create `be/src/market/price.service.ts`

- [ ] **Step 1: Implement** (typecheck; composition over tested pure units):

```ts
// be/src/market/price.service.ts
import { Injectable } from '@nestjs/common';
import { NavyConfigService } from '../config/config.service';
import { CoinGeckoClient } from './coingecko.client';
import { TtlCache } from './ttl-cache';
import { resolveKnownTokenId } from './resolve-token-id';
import { normalizePrice, normalizeTokenInfo, normalizeTopCoins, type PriceDto, type TokenInfoDto, type TopCoinDto } from './coingecko-normalize';

const PRICE_TTL = 60_000;      // upstream refreshes every 60s
const SEARCH_TTL = 24 * 60 * 60_000; // ids are stable
const TOP_TTL = 60_000;

@Injectable()
export class PriceService {
  private readonly client: CoinGeckoClient;
  private readonly cache = new TtlCache();
  constructor(private readonly cfg: NavyConfigService) {
    this.client = new CoinGeckoClient({ apiKey: cfg.coinGeckoApiKey, baseUrl: cfg.coinGeckoBaseUrl });
  }

  /** USD price (+24h/mktcap) for a set of coin ids. Cached per-id, coalesced. */
  async prices(ids: string[]): Promise<Record<string, PriceDto>> {
    const out: Record<string, PriceDto> = {};
    await Promise.all(ids.map(async (id) => {
      const dto = await this.cache.getOrLoad(`price:${id}`, PRICE_TTL, async () => normalizePrice(id, await this.client.simplePrice([id])));
      if (dto) out[id] = dto;
    }));
    return out;
  }

  /** ETH price in USD (or null if unavailable). */
  async ethUsd(): Promise<number | null> {
    const p = await this.prices(['ethereum']);
    return p['ethereum']?.priceUsd ?? null;
  }

  /** Resolve a user query to a coin id: static map first, else /search top match (cached 24h). */
  private async resolveId(query: string): Promise<string | null> {
    const known = resolveKnownTokenId(query);
    if (known) return known;
    return this.cache.getOrLoad(`search:${query.trim().toLowerCase()}`, SEARCH_TTL, async () => {
      const res = await this.client.search(query);
      return res?.coins?.[0]?.id ?? null;
    });
  }

  /** Rich token info for any CoinGecko token, or null if not found. */
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
```

- [ ] **Step 2: Typecheck** `cd be && pnpm build` → clean.

- [ ] **Step 3: Commit**

```bash
git add be/src/market/price.service.ts
git commit -m "feat(be): PriceService (cache + resolve + normalize)"
```

### Task A6: `MarketController` + module + app wiring

**Files:** Create `be/src/market/market.controller.ts`, `be/src/market/market.module.ts`; Modify `be/src/app.module.ts`; add env

- [ ] **Step 1: Controller**

```ts
// be/src/market/market.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PriceService } from './price.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Throttle } from '@nestjs/throttler';

@Controller('market')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class MarketController {
  constructor(private readonly prices: PriceService) {}

  @Get('prices')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  getPrices(@Query('ids') ids?: string) {
    const list = (ids ?? 'ethereum').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 25);
    return this.prices.prices(list);
  }

  @Get('token')
  @Throttle({ default: { ttl: 60000, limit: 40 } })
  async getToken(@Query('query') query: string) {
    const info = await this.prices.tokenInfo(query ?? '');
    return info ?? { error: `Couldn't find a token matching "${query ?? ''}"` };
  }

  @Get('top')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  getTop(@Query('limit') limit?: string) {
    return this.prices.topCoins(limit ? parseInt(limit, 10) : 10);
  }
}
```

- [ ] **Step 2: Module**

```ts
// be/src/market/market.module.ts
import { Module } from '@nestjs/common';
import { MarketController } from './market.controller';
import { PriceService } from './price.service';

@Module({
  controllers: [MarketController],
  providers: [PriceService],
  exports: [PriceService],
})
export class MarketModule {}
```

- [ ] **Step 3: Register** `MarketModule` in `be/src/app.module.ts` imports.

- [ ] **Step 4: Add env** to `be/.env`: `COINGECKO_API_KEY=` (leave blank for now; filled at verification).

- [ ] **Step 5: Build + boot smoke**

Run: `cd be && pnpm build` → clean. Then `pnpm start` ~15s and confirm no DI errors + routes `GET /market/{prices,token,top}` mapped. Stop it.

- [ ] **Step 6: Commit**

```bash
git add be/src/market/market.controller.ts be/src/market/market.module.ts be/src/app.module.ts
git commit -m "feat(be): market controller + module wiring"
```

---

## Phase B — Agent tools

### Task B1: Tool schemas `get_token_info` + `get_top_coins`

**Files:** Modify `be/src/agent/tool-schemas.ts`; Test `be/src/agent/tool-schemas.spec.ts`

- [ ] **Step 1: Update the names test** in `tool-schemas.spec.ts` — extend the expected `TOOL_NAMES` array to include the two new names:

```ts
    expect(TOOL_NAMES.sort()).toEqual([
      'build_farming_deposit', 'build_farming_withdraw', 'build_transfer',
      'get_farming_summary', 'get_payment_history', 'get_portfolio',
      'get_spending_analytics', 'get_token_info', 'get_top_coins', 'resolve_recipient',
    ].sort());
```

- [ ] **Step 2: Run** `cd be && pnpm test tool-schemas.spec` → FAIL (names mismatch).

- [ ] **Step 3: Add the two tools** to the `TOOLS` array in `tool-schemas.ts` (before the closing `]`):

```ts
  { type: 'function', function: { name: 'get_token_info', description: 'Look up live market data for ANY cryptocurrency by name or symbol (e.g. "BTC", "bitcoin", "solana"). Returns price, 24h/7d/30d change, market cap, rank, supply, ATH, and a short description. Use it to answer any price/market/"tell me about X" question. Summarize and analyze the result for the user — do not dump raw numbers.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Token name or symbol, e.g. "BTC" or "solana".' } }, required: ['query'], additionalProperties: false } } },
  { type: 'function', function: { name: 'get_top_coins', description: 'List the top cryptocurrencies by market capitalization (default 10). Use for "top coins" / "what is trending" questions.', parameters: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false } } },
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/agent/tool-schemas.ts be/src/agent/tool-schemas.spec.ts
git commit -m "feat(be): agent tools get_token_info + get_top_coins"
```

### Task B2: Agent handlers + portfolio USD + inject PriceService

**Files:** Modify `be/src/agent/agent-tools.service.ts`, `be/src/agent/agent.module.ts`, `be/src/agent/agent.service.ts`

- [ ] **Step 1: Inject `PriceService`** into `AgentToolsService`. Add the import + constructor param:

```ts
import { PriceService } from '../market/price.service';
```
and add `private readonly prices: PriceService,` to the constructor parameter list.

- [ ] **Step 2: Enrich `get_portfolio`** — replace its handler body's `return` so it adds USD (never blocking on price failure):

```ts
      get_portfolio: async () => {
        const [ethWei, usdc] = await Promise.all([
          this.chain.provider.getBalance(walletAddress),
          this.chain.usdc.balanceOf(walletAddress) as Promise<bigint>,
        ]);
        let farming: any = null;
        try { farming = await this.farming.getPosition(userId); } catch { /* no subwallet yet */ }
        let ethUsd: number | null = null, totalUsd: number | null = null;
        try {
          ethUsd = await this.prices.ethUsd();
          if (ethUsd != null) {
            const usdcUsd = Number(usdc) / 1e6;        // USDC = $1
            const ethAmt = Number(ethWei) / 1e18;
            totalUsd = Math.round((usdcUsd + ethAmt * ethUsd) * 100) / 100;
          }
        } catch { /* prices unavailable — omit USD, never block the portfolio */ }
        return { display: { kind: 'card' }, usdcBase: usdc.toString(), ethWei: ethWei.toString(), farming, ethUsd, totalUsd };
      },
```

- [ ] **Step 3: Add the two new handlers** to the returned map (alongside the others):

```ts
      get_token_info: async (a) => {
        const info = await this.prices.tokenInfo(String(a.query ?? ''));
        if (!info) return { error: `Couldn't find a token matching "${String(a.query ?? '')}"` };
        return { display: { kind: 'token' }, ...info };
      },
      get_top_coins: async (a) => {
        const limit = typeof a.limit === 'number' ? a.limit : 10;
        const coins = await this.prices.topCoins(limit);
        return { display: { kind: 'card' }, coins };
      },
```

- [ ] **Step 4: Import `MarketModule`** in `agent.module.ts` so `PriceService` resolves. Add `MarketModule` to the `imports` array (import it at top). `MarketModule` already `exports: [PriceService]`.

- [ ] **Step 5: Add the "analyze" line** to `SYSTEM_PROMPT` in `agent.service.ts` — append before the final `Be concise.` line:

```
You can also look up any cryptocurrency's market data with get_token_info and top coins with get_top_coins.
When you present token data, give a brief analysis (price, today's move, market position) in plain language —
do not just list raw numbers.
```

- [ ] **Step 6: Build + commit**

Run: `cd be && pnpm build` → clean; boot smoke (`pnpm start`) → no DI errors.

```bash
git add be/src/agent/agent-tools.service.ts be/src/agent/agent.module.ts be/src/agent/agent.service.ts
git commit -m "feat(be): agent token tools + portfolio USD via PriceService"
```

### Task B3: CoinGecko live smoke script

**Files:** Create `be/scripts/coingecko-smoke.mjs`

- [ ] **Step 1: Implement**

```js
// be/scripts/coingecko-smoke.mjs  (run: node scripts/coingecko-smoke.mjs)
import 'dotenv/config';
const key = process.env.COINGECKO_API_KEY;
const base = process.env.COINGECKO_BASE_URL || 'https://api.coingecko.com/api/v3';
if (!key) { console.error('COINGECKO_API_KEY required'); process.exit(2); }
const h = { headers: { accept: 'application/json', 'x-cg-demo-api-key': key } };

const price = await (await fetch(`${base}/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true`, h)).json();
if (typeof price?.ethereum?.usd !== 'number') throw new Error('no ETH price: ' + JSON.stringify(price));
console.log('OK ETH price $' + price.ethereum.usd);

const search = await (await fetch(`${base}/search?query=bitcoin`, h)).json();
const id = search?.coins?.[0]?.id;
if (id !== 'bitcoin') throw new Error('search failed: ' + JSON.stringify(search?.coins?.[0]));
const coin = await (await fetch(`${base}/coins/${id}?localization=false&tickers=false&sparkline=true`, h)).json();
if (typeof coin?.market_data?.current_price?.usd !== 'number') throw new Error('coin data failed');
console.log('OK bitcoin $' + coin.market_data.current_price.usd + ' rank #' + coin.market_cap_rank + ' sparkline pts ' + (coin.market_data.sparkline_7d?.price?.length ?? 0));
console.log('CoinGecko demo key works ✓');
```

- [ ] **Step 2: Syntax check** `cd be && node --check scripts/coingecko-smoke.mjs`.

- [ ] **Step 3: Commit**

```bash
git add be/scripts/coingecko-smoke.mjs
git commit -m "test(be): CoinGecko demo-key live smoke"
```

---

## Phase C — Expo UI

### Task C1: Market client (app)

**Files:** Create `expo-wallet/src/lib/market/marketClient.ts` (+ `.test.ts`)

- [ ] **Step 1: Write the failing test**

```ts
import { MarketClient } from './marketClient';

function fakeFetch(handler: (url: string) => any) {
  return async (url: string) => ({ ok: true, status: 200, json: async () => handler(url) }) as Response;
}

describe('MarketClient', () => {
  it('getPrices GETs /market/prices and returns the price map', async () => {
    let seen = '';
    const c = new MarketClient('http://x', fakeFetch((u) => { seen = u; return { ethereum: { id: 'ethereum', priceUsd: 3200, change24h: 1.2, marketCapUsd: 1 } }; }) as any);
    const p = await c.getPrices(['ethereum']);
    expect(p.ethereum.priceUsd).toBe(3200);
    expect(seen).toContain('/market/prices?ids=ethereum');
  });
}
);
```

- [ ] **Step 2: Run** `cd expo-wallet && pnpm test marketClient.test` → FAIL.

- [ ] **Step 3: Implement**

```ts
// expo-wallet/src/lib/market/marketClient.ts
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
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add expo-wallet/src/lib/market/marketClient.ts expo-wallet/src/lib/market/marketClient.test.ts
git commit -m "feat(expo): MarketClient getPrices"
```

### Task C2: Home portfolio USD

**Files:** Modify `expo-wallet/app/(tabs)/home.tsx`

- [ ] **Step 1: Add USD to the balance hero.** In `Home`, after balances load, fetch the ETH price and compute the USD total. Read the file first; then:
  - Add state `const [ethUsd, setEthUsd] = useState<number | null>(null);`
  - In the `load` callback (where `token`/`authedFetch` are available), after balances are set, fetch prices:
    ```ts
    if (authedFetch) {
      try {
        const prices = await new MarketClient(getEnv().navyApiUrl, authedFetch).getPrices(['ethereum']);
        setEthUsd(prices.ethereum?.priceUsd ?? null);
      } catch { setEthUsd(null); }
    }
    ```
    (import `MarketClient` from `@/lib/market/marketClient`.)
  - Compute a display total: `const usdcNum = usdc === '—' ? 0 : Number(usdc.replace(/,/g,'')) || 0; const ethNum = eth === '—' ? 0 : Number(eth) || 0; const totalUsd = ethUsd != null ? usdcNum + ethNum * ethUsd : null;`
  - In the hero, when `totalUsd != null`, show it as the primary figure formatted as USD (e.g. `$${totalUsd.toFixed(2)}`) with a one-line split subtitle `${usdc} USDC · ${eth} ETH ($${(ethNum*ethUsd).toFixed(2)})`. When `totalUsd == null`, keep the current USDC-amount display (graceful fallback).

- [ ] **Step 2: Typecheck** `cd expo-wallet && pnpm exec tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add expo-wallet/app/(tabs)/home.tsx
git commit -m "feat(expo): portfolio total in USD on Home"
```

### Task C3: TokenInfoCard + assistant rendering

**Files:** Create `expo-wallet/src/features/assistant/TokenInfoCard.tsx`; Modify `expo-wallet/app/(tabs)/assistant.tsx`

- [ ] **Step 1: Build `TokenInfoCard`** (`{ result: any }`), reusing the theme + the `react-native-svg` sparkline approach from `ChartCard.tsx` (read it first). Render: `name` (`SYMBOL`), `priceUsd` (formatted `$`), `change24h` colored green/red with a ± sign, `marketCapUsd` (compact e.g. `$1.3T` via a small `formatCompactUsd` helper inside the file), `rank` (`#1`), and a line sparkline from `sparkline7d` (scale to min/max; skip if fewer than 2 points). Optionally show a truncated `description`.

- [ ] **Step 2: Render it in `assistant.tsx`.** In the tool-result renderer switch, add a `kind === 'token'` branch:
  ```tsx
  if (kind === 'token') return <TokenInfoCard result={result} />;
  ```
  and for `get_top_coins` results (they come through `kind === 'card'` with a `coins` array), if `result.coins` is present render a compact ranked list (map `result.coins` to rows `#rank SYMBOL — $price (±24h%)`). Import `TokenInfoCard`.

- [ ] **Step 3: Typecheck** `cd expo-wallet && pnpm exec tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add expo-wallet/src/features/assistant/TokenInfoCard.tsx expo-wallet/app/(tabs)/assistant.tsx
git commit -m "feat(expo): TokenInfoCard + top-coins rendering in assistant"
```

---

## Phase D — Verification

### Task D1: Unit + build gates

- [ ] Run `cd be && pnpm test && pnpm build` — all pass (new: ttl-cache, coingecko-normalize, resolve-token-id, tool-schemas). Run `cd expo-wallet && pnpm test && pnpm exec tsc --noEmit` — all pass.

### Task D2: Live verification (needs the demo key)

Requires `COINGECKO_API_KEY` in `be/.env` + backend running + a dev user JWT + a free OpenRouter model.

- [ ] **Step 1: Key smoke** — `cd be && node scripts/coingecko-smoke.mjs` → prints ETH price + bitcoin data + "demo key works ✓".
- [ ] **Step 2: Endpoints** — with a dev JWT: `GET /market/prices?ids=ethereum` (→ price map), `GET /market/token?query=btc` (→ token info with sparkline), `GET /market/top?limit=5` (→ 5 coins).
- [ ] **Step 3: Agent** — `POST /agent/chat` `{"message":"what's the price of bitcoin?"}` → `tool_result` `get_token_info` + an analytical reply; `{"message":"what's my portfolio worth in usd?"}` → `get_portfolio` with `ethUsd`/`totalUsd` + a dollar answer; `{"message":"top 5 coins"}` → `get_top_coins`.
- [ ] **Step 4: Cache/coalescing** — hit `GET /market/prices?ids=ethereum` several times rapidly; confirm only the first triggers an upstream call (add a temporary log in `CoinGeckoClient.get` if needed, or observe latency: first ~200ms, rest instant).
- [ ] **Step 5: Record** results in `be/scripts/gateway-bringup.md` under "Market data bring-up".

---

## Self-Review notes (addressed)

- **Spec coverage:** CoinGecko client + demo header/base ✓ (A4); TTL+coalescing+serve-stale cache ✓ (A1); normalizers ✓ (A2); static id map + search fallback ✓ (A3/A5); `/simple/price` for portfolio, `/search`→`/coins/{id}` for info, `/coins/markets` for top ✓ (A5); market endpoints guarded+throttled ✓ (A6); agent `get_token_info` + `get_top_coins` + "analyze not dump" prompt ✓ (B1/B2); `get_portfolio` USD enrichment, non-blocking ✓ (B2); Home portfolio USD ✓ (C2); TokenInfoCard w/ sparkline ✓ (C3); demand-driven (no polling — nothing schedules a fetch) ✓; graceful degradation on empty key / 429 (serve-stale, omit USD) ✓; live smoke ✓ (B3/D2).
- **Type consistency:** `PriceDto`/`TokenInfoDto`/`TopCoinDto` shared (be normalize ↔ app expects `priceUsd`/`change24h`/`sparkline7d`); `PriceService.prices/ethUsd/tokenInfo/topCoins` signatures match controller + agent handlers; agent token result carries `display:{kind:'token'}` matching the assistant switch; `get_portfolio` adds `ethUsd`/`totalUsd` consumed nowhere required (additive).
- **Cap safety:** every fetch is lazy (user-triggered) + cached; no `@Interval`/scheduler added; static map avoids `/search` for wallet + common tokens.

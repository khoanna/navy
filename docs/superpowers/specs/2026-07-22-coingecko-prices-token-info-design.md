# Token Prices & Info (CoinGecko) — Design

**Date:** 2026-07-22
**Status:** Approved (brainstorm) → ready for planning
**Builds on:** the AI assistant (`be/src/agent`) + the wallet portfolio (`expo-wallet` Home / `get_portfolio`).
**Apps touched:** `be/` (new `market` module + agent tool + `get_portfolio` enrichment), `expo-wallet/` (Home portfolio USD + a chat token card).

## 1. Overview

Add market data via the CoinGecko **free "Demo"** API so:
- **Portfolio USD** — the app shows the user's balance in dollars (USDC = $1, ETH × live price), and the assistant can answer "what's my portfolio worth?".
- **Any-token info** — the assistant answers "price of BTC", "tell me about Solana", "is ETH up today" about **any** CoinGecko-tracked token, returning a concise **analysis** (not a data dump) plus a token card (price, 24h change, market cap, rank, 7-day sparkline).

A shared, coalesced, demand-driven cache keeps us within the free tier and keeps the API key server-side.

### In scope
- Backend `market` module: CoinGecko client, TTL+coalescing cache, price/token/top endpoints.
- Agent tool `get_token_info(query)` (+ a lightweight `get_top_coins`), and `get_portfolio` enriched with `ethUsd`/`totalUsd`.
- App: Home portfolio in USD (total + per-asset); a `TokenInfoCard` (with sparkline) rendered in the assistant chat.

### Out of scope (v1)
- USD→amount conversion ("send $10 of ETH").
- Multi-fiat (USD only); historical charts beyond the 7-day sparkline.
- On-chain/DEX prices (CoinGecko only).
- Distributed cache (a documented mainnet gate) + a paid CoinGecko key for production traffic.

## 2. CoinGecko facts (drive the design)

- **Base URL** `https://api.coingecko.com/api/v3`; auth header **`x-cg-demo-api-key`** (demo key, not `pro-api`).
- **Rate limits:** generous per-minute (~30–100/min) but a hard **10,000 calls/month** cap — the binding constraint. Upstream prices refresh every **60s** on demo.
- **Endpoints (all on the demo plan), one per job:**
  - `/simple/price?ids=<id>&vs_currencies=usd&include_24hr_change=true&include_market_cap=true` — portfolio valuation (lightest).
  - `/search?query=<q>` — resolve a symbol/name → canonical coin **id** (results ranked by market cap; take the top match).
  - `/coins/{id}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=false&sparkline=true` — the **rich** single-token profile: description, links, categories, supply, ATH/ATL, market data, 7-day sparkline.
  - `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=<N>&sparkline=false&price_change_percentage=24h` — a **ranked list** for "top coins / trending".

**Cap discipline (critical):** the system is **demand-driven — never background-poll.** Every fetch happens only in response to a user opening Home or asking the assistant, then serves from cache. TTLs: prices/market data **~60s** (matches upstream refresh), `/search` id-resolution **~24h** (ids are stable). **Concurrent callers for the same key share one in-flight upstream call** (coalescing), so a spike of users = one call. Known tokens **skip `/search`** via a small static symbol→id map (`eth→ethereum`, `btc→bitcoin`, `usdc→usd-coin`, …).

## 3. Backend `be/src/market` module

- **`CoinGeckoClient`** (native `fetch`, like `OpenRouterClient`): `simplePrice(ids)`, `search(query)`, `coin(id)`, `topCoins(perPage)`. Sends the demo header; base + key from config. Typecheck-verified.
- **`TtlCache<T>`** (pure, unit-tested): `getOrLoad(key, ttlMs, loader)` — returns a cached value if fresh; otherwise runs `loader` **once** for concurrent callers (in-flight promise dedup) and caches the result with an expiry. On loader error, if a stale value exists, return it (serve-stale-on-error) and don't cache the error. Includes a `now()` injection point so TTL expiry is testable without real time.
- **`coingecko-normalize.ts`** (pure, unit-tested): shape CoinGecko's verbose JSON into compact DTOs:
  - `PriceDto { id, priceUsd, change24h, marketCapUsd }`
  - `TokenInfoDto { id, symbol, name, priceUsd, change24h, change7d, change30d, marketCapUsd, rank, volume24h, ath, athChangePct, atl, circulatingSupply, totalSupply, maxSupply, description, homepage, sparkline7d: number[] }`
  - `TopCoinDto { id, symbol, name, priceUsd, change24h, marketCapUsd, rank }`
- **`resolveTokenId.ts`** (pure, unit-tested): normalize a user query → id via the static map first, else return null (caller falls back to `/search`).
- **`PriceService`**: composes client + cache + normalizers + resolution. `ethUsd()`, `tokenInfo(query)`, `topCoins(n)`.
- **`MarketController`** (guarded `@Roles('user')`, throttled): `GET /market/prices?ids=` (compact price map for the app), `GET /market/token?query=`, `GET /market/top?limit=`.
- **Config** (`NavyConfigService`): `coinGeckoApiKey` (env `COINGECKO_API_KEY`, non-throwing default `''`), `coinGeckoBaseUrl` (default `https://api.coingecko.com/api/v3`), optional TTL overrides. When the key is empty, the service returns a structured "prices unavailable" so the app/agent degrade gracefully (never block).

## 4. Agent tools + analysis

- New tool **`get_token_info(query)`** → `TokenInfoDto` with `display:{kind:'token'}`. Handles **any** token (static map → else `/search` → `/coins/{id}`). The system prompt instructs the assistant to **analyze, not dump**: a short, friendly read of price + today's move + market position (e.g. *"Bitcoin's at $67,240, +2.3% today — still #1 by market cap ($1.3T). 7-day trend is up ~5%."*).
- New tool **`get_top_coins(limit)`** → `TopCoinDto[]` (default 10) with `display:{kind:'card'}`, for "top coins by market cap / what's trending".
- **`get_portfolio` enriched**: add `ethUsd` and `totalUsd` (USDC base as dollars + ETH×`ethUsd`). If the price fetch fails/absent, omit the USD fields and return balances as today — **never block** the portfolio read.
- BigInt discipline preserved (all money fields are strings; prices are plain numbers).

## 5. App UI

- **Home** (`app/(tabs)/home.tsx`): the balance hero shows the **total in USD** (USDC + ETH×price) with the USDC/ETH breakdown; per-asset USD subtitles. The app calls the backend **`GET /market/prices?ids=ethereum`** (key server-side, shared cache) — never CoinGecko directly. If USD is unavailable, fall back to today's USDC-amount display.
- **Assistant chat**: a new **`TokenInfoCard`** renders the `kind:'token'` result — name/symbol, price, 24h change (green/red), market cap + rank, and a 7-day **sparkline** (reusing the `react-native-svg` chart path from `ChartCard`). `get_top_coins` renders a compact ranked list.
- Price display lives **only** in the portfolio (Home) as a persistent surface; the token card appears **only** inside chat on demand.

## 6. Error handling, testing, non-goals

- **Errors:** CoinGecko 429/5xx/timeout → serve the last cached value even if slightly stale; if nothing cached → a structured `{error}` the assistant relays ("couldn't fetch prices right now") and the app hides USD (shows raw amounts). Unknown token → "couldn't find a token matching 'X'". Empty API key → graceful "prices unavailable".
- **Testing:**
  - Pure units: `TtlCache` (fresh hit, TTL expiry via injected `now`, **in-flight coalescing** = one loader call for N concurrent, serve-stale-on-error), `coingecko-normalize` (each DTO from a realistic payload), `resolveTokenId` (static map hits + misses).
  - Client/service: typecheck + a **live smoke** against CoinGecko with the real demo key (fetch ETH price + a token like `bitcoin`).
  - Agent/app: `tsc`/`build` gates; a live `/agent/chat` check ("price of bitcoin", "what's my portfolio worth") on the running backend with a free model.
- **Non-goals / mainnet gates:** USD→amount, multi-fiat, distributed cache, paid CoinGecko key for production traffic — deferred per `docs/PRODUCTION.md`.

## 7. Open items for the plan

- The static symbol→id map's initial entries (at least `eth`, `weth`, `btc`, `usdc`, `usdt`, `sol`, `bnb`) + how the agent tool picks the top `/search` match.
- Exact cache TTL constants (prices 60s, search 24h) as config-overridable env.
- `TokenInfoCard` sparkline scaling for flat/short series.
- Whether Home shows a single USD total or a small "USDC $x · ETH $y" split (pick one in the plan; default: total + a one-line split).

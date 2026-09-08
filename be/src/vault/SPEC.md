# SrclaClient Specification

## Overview
HTTP client for the `srcla` service, which owns yield forecasting, allocation decisions, and on-chain keeper
execution. `be` is a **read-only** consumer: it never computes allocations and never calls the keeper.

## Interface

### Types
- `StrategyAllocation`: Total assets and per-adapter allocation breakdown
- `Decision`: Strategy decision with hash, policy version, timestamp, and action
- `HarvestRecord`: Historical harvest/claim events
- `PaginatedResponse<T>`: Standard paginated response wrapper

### Methods
| Method | Endpoint | Description |
|--------|----------|-------------|
| `getCurrentAllocation()` | `GET /v1/allocation` | Current vault allocation across adapters |
| `getDecision(hash)` | `GET /v1/decisions/:hash` | Single decision by hash |
| `getDecisions(params?)` | `GET /v1/decisions` | Paginated decisions list |
| `getLatestDecision()` | `GET /v1/decisions?limit=1` | Most recent decision, or `null` |
| `getHarvests(params?)` | `GET /v1/harvests` | Paginated harvest records |
| `getMarkets()` | `GET /v1/markets` | Available yield markets |
| `getHealth()` | `GET /v1/health` | Service health status |
| `reviewProposal(req)` | `POST /v1/proposals/review` | Submit a proposal for policy review (currently unreferenced by `be`) |

`triggerRebalance()` was removed: paper §10.2 says `be` "does not relay farming transactions,
possess the allocator key, or execute rebalances". Composing srcla *history* over HTTP is
permitted; asking srcla to run a decision cycle is not.

## Configuration
- Base URL from `NavyConfigService.srclaApiUrl` (env `SRCLA_API_URL`, default `http://localhost:3100`)
- Default timeout: 5000 ms, enforced with an `AbortController`
- Connection and timeout errors are rethrown as descriptive `Error`s

## Dependencies
- Native `fetch` — matching the `CoinGeckoClient` / `OpenRouterClient` pattern. No `@nestjs/axios`, no `rxjs`.

## Consumers
`be/src/vault/vault-admin.controller.ts` re-serves this under
`/vault/admin/{strategy,decisions,harvests,cohorts,rebalance/status,rebalance/proposals}` —
all `GET`, with no trigger or other mutation.

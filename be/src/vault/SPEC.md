# SrclaClient Specification

## Overview
HTTP client for querying the /srcla service that provides strategy allocation data and rebalancing decisions.

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
| `getHarvests(params?)` | `GET /v1/harvests` | Paginated harvest records |
| `getMarkets()` | `GET /v1/markets` | Available yield markets |
| `getHealth()` | `GET /v1/health` | Service health status |

## Configuration
- Base URL injected via `'SRCLA_API_URL'` token
- Default timeout: 5000ms
- Connection errors thrown as descriptive `Error`

## Dependencies
- `@nestjs/axios` HttpService
- `rxjs` firstValueFrom

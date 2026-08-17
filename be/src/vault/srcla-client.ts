/**
 * SrclaClient — queries the /srcla service running at a configurable base URL.
 * Uses native fetch to match the existing codebase pattern (see CoinGeckoClient, OpenRouterClient).
 *
 * The SRCLA service dynamically evaluates all markets based on:
 * - Forecast Method: Rolling Quantile (§7.2.1) - window=7, quantile=5%
 * - Coverage Target: 95%
 * - Artifact Hash: 5ed517d128bab909
 *
 * Markets are ranked by lower-bound forecast (Rolling 5th percentile).
 * Rankings are recalculated by the cronjob on each decision cycle.
 */
import { Injectable } from '@nestjs/common';
import { NavyConfigService } from '../config/config.service';

/** SRCLA production configuration constants */
export const SRCLA_CONFIG = {
  FORECAST_METHOD: 'rolling' as const,
  FORECAST_WINDOW_DAYS: 7,
  FORECAST_QUANTILE: 0.05,
  COVERAGE_TARGET: 0.95,
  ARTIFACT_HASH: '5ed517d128bab909',
} as const;

export interface StrategyAllocation {
  totalAssets: string;
  allocations: Array<{
    adapter: string;
    name: string;
    assets: string;
    percentage: number;
  }>;
}

export interface Decision {
  decisionHash: string;
  policyVersion: string;
  timestamp: string;
  admissions: string[];
  forecasts: ForecastResult[];
  reserveBase: string;
  allocation: unknown;
  actionDecision: {
    action: string;
    amount: string;
    targetAdapter: string | null;
    reason: string;
  };
}

/** SRCLA forecast result from the service - dynamically computed */
export interface ForecastResult {
  marketId: string;
  horizon: number;
  meanReturn: string;
  lowerReturn: string;
  coverage: number;
  method: string;
  config: Record<string, unknown>;
}

export interface HarvestRecord {
  id: string;
  timestamp: string;
  adapter: string;
  rewardToken: string;
  amountIn: string;
  amountOutBase: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    count: number;
    nextCursor?: string;
  };
}

@Injectable()
export class SrclaClient {
  private readonly baseUrl: string;
  private readonly timeout = 5000;

  constructor(private readonly config: NavyConfigService) {
    this.baseUrl = config.srclaApiUrl;
  }

  async getCurrentAllocation(): Promise<StrategyAllocation> {
    return this.get<StrategyAllocation>('/v1/allocation');
  }

  async getDecision(hash: string): Promise<Decision> {
    return this.get<Decision>(`/v1/decisions/${hash}`);
  }

  async getDecisions(params?: {
    cursor?: string;
    limit?: string;
  }): Promise<PaginatedResponse<Decision>> {
    return this.get<PaginatedResponse<Decision>>('/v1/decisions', params);
  }

  async getHarvests(params?: {
    adapter?: string;
    cursor?: string;
    limit?: string;
  }): Promise<PaginatedResponse<HarvestRecord>> {
    return this.get<PaginatedResponse<HarvestRecord>>('/v1/harvests', params);
  }

  async getMarkets(): Promise<unknown[]> {
    const response = await this.get<{ data: unknown[] }>('/v1/markets');
    return response.data;
  }

  async getHealth(): Promise<{ status: string; lastSnapshot: string | null }> {
    return this.get('/v1/health');
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(path, this.baseUrl);

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) url.searchParams.set(k, v);
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`SRCLA ${res.status}: ${await res.text().catch(() => '')}`);
      }

      return res.json() as Promise<T>;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`SRCLA request timeout after ${this.timeout}ms`);
      }
      if (error instanceof Error) {
        const cause = (error as any).cause as { code?: string } | undefined;
        if (error.message.includes('ECONNREFUSED') || cause?.code === 'ECONNREFUSED') {
          throw new Error(`SRCLA service unavailable at ${this.baseUrl}`);
        }
      }
      throw error;
    }
  }
}

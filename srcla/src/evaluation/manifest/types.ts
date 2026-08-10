/**
 * Evaluation manifest types and factory
 */
import { BASELINES, ABLATIONS } from './constants.js';

export interface ManifestConfig {
  evaluationId: string;
  startDate: Date;
  endDate: Date;
  forecastMethod: {
    method: 'rolling' | 'ew-residual' | 'arx';
    config: Record<string, unknown>;
  };
  horizons: number[]; // Seconds
  tiers: bigint[]; // USDC amounts
  regimes?: string[];
  coverageTarget: number; // 0.95
  significanceLevel: number; // 0.05
}

export type ManifestWithBaselines = ManifestConfig & {
  baselines: typeof BASELINES;
  ablations: typeof ABLATIONS;
};

/**
 * Create a manifest with baselines and ablations filled in
 */
export function createManifest(config: ManifestConfig): ManifestWithBaselines {
  return {
    ...config,
    baselines: BASELINES,
    ablations: ABLATIONS,
  };
}

/**
 * Validate a manifest config
 */
export function validateManifest(config: ManifestConfig): void {
  if (!config.evaluationId) throw new Error('evaluationId is required');
  if (config.startDate >= config.endDate) throw new Error('startDate must be before endDate');
  if (config.horizons.length === 0) throw new Error('At least one horizon is required');
  if (config.horizons.some((h) => h <= 0)) throw new Error('All horizons must be positive');
  if (config.tiers.length === 0) throw new Error('At least one tier is required');
  if (config.coverageTarget <= 0 || config.coverageTarget > 1) {
    throw new Error('coverageTarget must be between 0 and 1');
  }
  if (config.significanceLevel <= 0 || config.significanceLevel > 1) {
    throw new Error('significanceLevel must be between 0 and 1');
  }
}

/**
 * Freeze a manifest to JSON for reproducible evaluation
 */
export function freezeManifest(manifest: ManifestConfig): string {
  return JSON.stringify({
    ...manifest,
    startDate: manifest.startDate.toISOString(),
    endDate: manifest.endDate.toISOString(),
    tiers: manifest.tiers.map((t) => t.toString()),
    frozenAt: new Date().toISOString(),
  });
}

/**
 * Thaw a frozen manifest from JSON
 */
export function thawManifest(json: string): ManifestConfig {
  const parsed = JSON.parse(json) as {
    evaluationId: string;
    startDate: string;
    endDate: string;
    forecastMethod: { method: 'rolling' | 'ew-residual' | 'arx'; config: Record<string, unknown> };
    horizons: number[];
    tiers: string[];
    regimes: string[] | undefined;
    coverageTarget: number;
    significanceLevel: number;
  };
  const result: ManifestConfig = {
    evaluationId: parsed.evaluationId,
    startDate: new Date(parsed.startDate),
    endDate: new Date(parsed.endDate),
    forecastMethod: parsed.forecastMethod,
    horizons: parsed.horizons,
    tiers: parsed.tiers.map((t) => BigInt(t)),
    coverageTarget: parsed.coverageTarget,
    significanceLevel: parsed.significanceLevel,
  };
  if (parsed.regimes) {
    result.regimes = parsed.regimes;
  }
  return result;
}

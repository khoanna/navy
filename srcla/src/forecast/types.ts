import type { HorizonSeconds } from '../policy/registered.js';
export type { HorizonSeconds };

export interface ForecastResult {
  marketId: string;
  horizon: HorizonSeconds;
  meanReturn: bigint;
  lowerReturn: bigint;
  coverage: number;
  method: string;
  config: Record<string, unknown>;
  /** Effective capacity after cold-start adjustments (optional) */
  effectiveCap?: bigint;
}

export interface CalibrationResult {
  method: string;
  config: Record<string, unknown>;
  metrics: {
    mae: number;
    rmse: number;
    coverage: number;
    sharpness: number;
    pinballLoss: number;
  };
  artifactHash: string;
}

export interface ForecastCandidate {
  method: 'rolling' | 'ew-residual' | 'arx';
  config: Record<string, unknown>;
  loss: number;
}

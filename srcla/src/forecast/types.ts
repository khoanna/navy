export type HorizonSeconds = 86400 | 604800 | 2592000;

export interface ForecastResult {
  marketId: string;
  horizon: HorizonSeconds;
  meanReturn: bigint;
  lowerReturn: bigint;
  coverage: number;
  method: string;
  config: Record<string, unknown>;
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

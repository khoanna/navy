export interface SimulatorConfig {
  marketId: string;
  name: string;
  cash: bigint;
  borrows: bigint;
  reserves: bigint;
  supplyRate: bigint;
  configDigest: string;
}

export interface SimulatedRate {
  marketId: string;
  horizonSeconds: number;
  meanReturn: bigint;
  lowerReturn: bigint;
  capacity: bigint;
}

export interface ISimulator {
  simulateRate(config: SimulatorConfig, horizonSeconds: number): SimulatedRate;
  verifyFixtures?(): Promise<boolean>;
}

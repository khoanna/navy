import { SimulatorConfig, SimulatedRate, ISimulator } from './simulator.js';
import { utilization, compound, WAD } from './math.js';

export class AaveV3Simulator implements ISimulator {
  simulateRate(config: SimulatorConfig, horizonSeconds: number): SimulatedRate {
    const util = utilization(config.cash, config.borrows);

    // Mean return = compound at current rate
    const meanReturn = compound(WAD, config.supplyRate, BigInt(horizonSeconds));

    // Conservative: assume utilization increases to 90%
    const stressedUtil = (90n * WAD) / 100n;
    const stressFactor = stressedUtil > util
      ? WAD + ((stressedUtil - util) * 2n) / WAD
      : WAD;

    const lowerReturn = (meanReturn * stressFactor) / WAD;

    // Capacity limited by utilization headroom
    const capacity = util > (70n * WAD) / 100n
      ? config.cash / 10n
      : 0n;

    return {
      marketId: config.marketId,
      horizonSeconds,
      meanReturn,
      lowerReturn,
      capacity,
    };
  }
}

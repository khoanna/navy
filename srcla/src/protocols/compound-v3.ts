import { SimulatorConfig, SimulatedRate, ISimulator } from './simulator.js';
import { compound, WAD } from './math.js';

export class CompoundV3Simulator implements ISimulator {
  simulateRate(config: SimulatorConfig, horizonSeconds: number): SimulatedRate {
    const meanReturn = compound(WAD, config.supplyRate, BigInt(horizonSeconds));

    // Compound is more predictable - tighter lower bound
    const lowerReturn = (meanReturn * 99n) / 100n;

    const capacity = config.cash / 10n;

    return {
      marketId: config.marketId,
      horizonSeconds,
      meanReturn,
      lowerReturn,
      capacity,
    };
  }

  presentValue(
    cTokenBalance: bigint,
    supplyIndex: bigint,
    currentIndex: bigint
  ): bigint {
    return (cTokenBalance * currentIndex) / supplyIndex;
  }
}

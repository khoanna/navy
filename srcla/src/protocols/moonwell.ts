import { SimulatorConfig, SimulatedRate, ISimulator } from './simulator.js';
import { compound, WAD } from './math.js';

export class MoonwellSimulator implements ISimulator {
  simulateRate(config: SimulatorConfig, horizonSeconds: number): SimulatedRate {
    const meanReturn = compound(WAD, config.supplyRate, BigInt(horizonSeconds));

    // Moonwell has less liquidity - wider lower bound
    const lowerReturn = (meanReturn * 97n) / 100n;

    const capacity = config.cash / 20n;

    return {
      marketId: config.marketId,
      horizonSeconds,
      meanReturn,
      lowerReturn,
      capacity,
    };
  }

  exchangeRate(
    totalSupply: bigint,
    totalBorrows: bigint,
    cash: bigint,
    reserves: bigint
  ): bigint {
    if (totalSupply === 0n) return WAD;
    const cashPlusBorrowsMinusReserves = cash + totalBorrows - reserves;
    return (cashPlusBorrowsMinusReserves * WAD) / totalSupply;
  }
}

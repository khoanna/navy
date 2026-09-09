/**
 * Stressed liquid coverage — the one definition §11.4 grades and the optimiser
 * must enforce.
 *
 * The evaluation grades allocations on "stressed liquid coverage", but the
 * optimiser enforces a different liquidity computation in its requiredReserve
 * logic. They must agree on what they measure. This module defines it: liquid
 * cash available to meet demands at {5%, 10%, 25%, 50%} of TVL, conservatively
 * counted as idle + sum[min(balance, venueCash - balance)] per venue (the
 * "assume our own supplied cash is borrowed out" rule from §11.4).
 *
 * Arithmetic ported verbatim from replay.ts:394-415.
 */

/** Registered §8.1 stress demand set, in bps of TVL. */
export const REGISTERED_STRESS_DEMAND_BPS = [500, 1000, 2500, 5000] as const;

/** Coverage floor: allocations scoring below this per §11.4 are ineligible. */
export const REGISTERED_COVERAGE_FLOOR = 0.99;

export interface CoverageResult {
  /** Worst-case ratio across all registered demand levels. */
  worst: number;
  /** Coverage ratio at each demand level. */
  byDemand: Array<{ demandBps: number; ratio: number }>;
  /** Total liquid USDC available (idle + venue liquidity). */
  liquidBase: bigint;
}

/**
 * Compute stressed liquid coverage: the fraction of TVL available to meet
 * demands at registered levels, conservatively counting only idle and the
 * external cash each venue holds (not the vault's own supplied balance).
 *
 * @param args.holdings Map from market ID to balance (base units)
 * @param args.idleBase Idle USDC in the vault (base units)
 * @param args.venueCashByMarket Map from market ID to venue cash on hand (base units)
 * @param args.totalAssetsBase Total vault assets (base units)
 * @param args.demandBps Optional override of demand levels (defaults to registered set)
 */
export function stressedCoverage(args: {
  holdings: ReadonlyMap<string, bigint>;
  idleBase: bigint;
  venueCashByMarket: ReadonlyMap<string, bigint>;
  totalAssetsBase: bigint;
  demandBps?: readonly number[];
}): CoverageResult {
  const tvl = args.totalAssetsBase;
  const demandLevels = args.demandBps ?? REGISTERED_STRESS_DEMAND_BPS;

  // Early exit for empty vault
  if (tvl <= 0n) {
    return {
      worst: 1,
      byDemand: demandLevels.map((bps) => ({ demandBps: bps, ratio: 1 })),
      liquidBase: args.idleBase,
    };
  }

  // Compute total liquid: idle + conservative external venue liquidity
  let liquid = args.idleBase;
  for (const [marketId, balance] of args.holdings) {
    if (balance <= 0n) continue;
    const venueCash = args.venueCashByMarket.get(marketId) ?? 0n;
    // External cash = venue cash beyond our balance; we can access at most our own balance of it
    const external = venueCash > balance ? venueCash - balance : 0n;
    liquid += balance < external ? balance : external;
  }

  // Compute coverage ratios at each demand level
  let worst = 1;
  const byDemand: Array<{ demandBps: number; ratio: number }> = [];

  for (const bps of demandLevels) {
    const demand = (tvl * BigInt(bps)) / 10_000n;
    if (demand <= 0n) {
      byDemand.push({ demandBps: bps, ratio: 1 });
      continue;
    }
    const ratio = liquid >= demand ? 1 : Number(liquid) / Number(demand);
    byDemand.push({ demandBps: bps, ratio });
    if (ratio < worst) worst = ratio;
  }

  return { worst, byDemand, liquidBase: liquid };
}

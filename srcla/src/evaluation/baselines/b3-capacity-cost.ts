/**
 * B3: Capacity + Cost Gate baseline
 *
 * B2 + movement cost threshold. Won't deploy if expected benefit < cost.
 */
import type { BaselinePolicy } from './types.js';
import type { BaselineAction } from '../replay/replay.js';

export const b3Policy: BaselinePolicy = (state, snapshot): BaselineAction[] => {
  const actions: BaselineAction[] = [];
  const idleBase = state.idleBase;

  if (idleBase === 0n) return [];

  // Movement cost threshold: 1% = 100 bps
  const MIN_BENEFIT_BPS = 100n;
  // Estimated holding period: 7 days
  const ESTIMATED_DAYS = 7n;

  const markets = [...snapshot.snapshots]
    .filter((m) => !m.paused && m.capBps > 0)
    .sort((a, b) => Number(b.supplyRateE18 - a.supplyRateE18));

  let remaining = idleBase;

  for (const market of markets) {
    if (remaining === 0n) break;

    const marketCapacity = (state.totalAssets * BigInt(market.capBps)) / 10_000n;
    const currentExposure = state.strategyBalances.get(market.marketId) ?? 0n;
    const available = marketCapacity > currentExposure ? marketCapacity - currentExposure : 0n;

    if (available === 0n) continue;

    // Expected benefit: rate * time (in bps/day)
    const dailyBenefitBps = Number(market.supplyRateE18) / 1e22;
    const totalBenefitBps = dailyBenefitBps * Number(ESTIMATED_DAYS);

    // Only deploy if benefit > cost threshold
    if (BigInt(Math.floor(totalBenefitBps)) > MIN_BENEFIT_BPS) {
      const deployAmount = available < remaining ? available : remaining;
      actions.push({ kind: 'deploy', adapter: market.marketId, amount: deployAmount });
      remaining -= deployAmount;
    }
  }

  return actions;
};

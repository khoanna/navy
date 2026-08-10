/**
 * B2: Capacity-Aware baseline
 *
 * Deploy to markets with available capacity, using post-deposit rate simulation.
 * Ignores uncertainty/lower bound.
 */
import type { BaselinePolicy } from './types.js';
import type { BaselineAction } from '../replay/replay.js';

export const b2Policy: BaselinePolicy = (state, snapshot): BaselineAction[] => {
  const actions: BaselineAction[] = [];
  const idleBase = state.idleBase;

  if (idleBase === 0n) return [];

  // Sort markets by rate, filter paused
  const markets = [...snapshot.snapshots]
    .filter((m) => !m.paused && m.capBps > 0)
    .sort((a, b) => Number(b.supplyRateE18 - a.supplyRateE18));

  if (markets.length === 0) return [];

  let remaining = idleBase;

  for (const market of markets) {
    if (remaining === 0n) break;

    // Capacity = min(adapter cap, protocol cash)
    const marketCapacity = (state.totalAssets * BigInt(market.capBps)) / 10_000n;
    const currentExposure = state.strategyBalances.get(market.marketId) ?? 0n;
    const available = marketCapacity > currentExposure ? marketCapacity - currentExposure : 0n;

    if (available > 0n) {
      const deployAmount = available < remaining ? available : remaining;
      actions.push({ kind: 'deploy', adapter: market.marketId, amount: deployAmount });
      remaining -= deployAmount;
    }
  }

  return actions;
};

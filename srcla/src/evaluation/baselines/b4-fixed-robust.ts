/**
 * B4: Fixed Robust Allocation baseline
 *
 * Frozen allocation: 40/40/20 across available markets sorted by rate.
 * Non-adaptive — ignores current market conditions.
 * Uses marketId (adapter address) as stable key instead of hardcoded strings.
 */
import type { BaselinePolicy } from './types.js';
import type { BaselineAction } from '../replay/replay.js';

export const b4Policy: BaselinePolicy = (state, snapshot): BaselineAction[] => {
  const actions: BaselineAction[] = [];

  // Use marketId (adapter address) as stable key — not hardcoded strings
  const availableAdapters = snapshot.snapshots
    .filter((m) => !m.paused && m.capBps > 0)
    .sort((a, b) => Number(b.supplyRateE18 - a.supplyRateE18));

  if (availableAdapters.length === 0) return actions;

  // Fixed 40/40/20 allocation across available markets by adapter address
  const totalToDeploy = state.idleBase;
  if (totalToDeploy === 0n) return actions;

  const amount1 = totalToDeploy * 40n / 100n;
  const amount2 = totalToDeploy * 40n / 100n;
  const amount3 = totalToDeploy * 20n / 100n;

  // Map allocation to actual adapter addresses from snapshot
  const targets = [
    { adapter: availableAdapters[0]!.marketId, amount: amount1 },
    { adapter: availableAdapters[1]?.marketId ?? availableAdapters[0]!.marketId, amount: amount2 },
    { adapter: availableAdapters[2]?.marketId ?? availableAdapters[0]!.marketId, amount: amount3 },
  ];

  for (const target of targets) {
    if (target.amount > 0n) {
      const current = state.strategyBalances.get(target.adapter) ?? 0n;
      const diff = target.amount - current;
      if (diff > 0n) {
        actions.push({ kind: 'deploy', adapter: target.adapter, amount: diff });
      } else if (diff < 0n) {
        actions.push({ kind: 'divest', adapter: target.adapter, amount: -diff });
      }
    }
  }

  return actions;
};

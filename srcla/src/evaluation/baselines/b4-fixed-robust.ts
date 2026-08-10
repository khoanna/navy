/**
 * B4: Fixed Robust Allocation baseline
 *
 * Frozen allocation: 40% compound, 40% aave, 20% moonwell.
 * Non-adaptive — ignores current market conditions.
 * Only targets adapters present in the current snapshot's markets.
 */
import type { BaselinePolicy } from './types.js';
import type { BaselineAction } from '../replay/replay.js';

// Fixed allocation targets in basis points
const TARGETS: Record<string, bigint> = {
  compound: 4_000n,
  aave: 4_000n,
  moonwell: 2_000n,
};

export const b4Policy: BaselinePolicy = (state, snapshot): BaselineAction[] => {
  const actions: BaselineAction[] = [];

  // Only target adapters that exist in the current snapshot
  const availableAdapters = new Set(snapshot.snapshots.map((m) => m.marketId));

  for (const [adapter, targetBps] of Object.entries(TARGETS)) {
    // Skip if adapter not available in this snapshot
    if (!availableAdapters.has(adapter)) continue;

    const current = state.strategyBalances.get(adapter) ?? 0n;
    const target = (state.totalAssets * targetBps) / 10_000n;
    const diff = target - current;

    if (diff > 0n) {
      actions.push({ kind: 'deploy', adapter, amount: diff });
    } else if (diff < 0n) {
      actions.push({ kind: 'divest', adapter, amount: -diff });
    }
  }

  return actions;
};

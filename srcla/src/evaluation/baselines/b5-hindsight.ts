/**
 * B5: Hindsight (Diagnostic Only) baseline
 *
 * Perfect foresight — uses future realized returns from forecast labels.
 * NON-DEPLOYABLE — for diagnostic comparison only.
 *
 * This policy demonstrates the theoretical upper bound by knowing
 * which market will perform best ahead of time.
 */
import type { BaselinePolicy } from './types.js';
import type { BaselineAction } from '../replay/replay.js';
import type { TimeOrderedSnapshot } from '../dataset.js';
import type { VaultState } from '../replay/state.js';

export const b5Policy: BaselinePolicy = (
  state: VaultState,
  snapshot: TimeOrderedSnapshot,
): BaselineAction[] => {
  const actions: BaselineAction[] = [];
  const idleBase = state.idleBase;

  if (idleBase === 0n) return [];

  // Get forecast labels for the next period
  // In evaluation, labels are available with realized returns
  const labels = snapshot.snapshots.map((m) => {
    // Look up realized return from labels if available
    // For now, use a placeholder — in real evaluation this comes from dataset
    const realizedReturn = (m as { futureReturn?: bigint }).futureReturn ?? m.supplyRateE18;
    return { marketId: m.marketId, rate: realizedReturn };
  });

  if (labels.length === 0) return [];

  // Sort by highest future return
  const sorted = [...labels].sort((a, b) => Number(b.rate - a.rate));

  let remaining = idleBase;

  for (const market of sorted) {
    if (remaining === 0n) break;

    const marketSnap = snapshot.snapshots.find((s) => s.marketId === market.marketId);
    if (!marketSnap || marketSnap.paused) continue;

    const marketCapacity = (state.totalAssets * BigInt(marketSnap.capBps)) / 10_000n;
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

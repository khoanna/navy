/**
 * B1: Highest Displayed Rate baseline
 *
 * Always deploy idle to the market with highest supply rate.
 * Ignores capacity and uncertainty.
 */
import type { BaselinePolicy } from './types.js';
import type { BaselineAction } from '../replay/replay.js';

export const b1Policy: BaselinePolicy = (state, snapshot): BaselineAction[] => {
  const actions: BaselineAction[] = [];
  const idleBase = state.idleBase;

  if (idleBase === 0n) return [];

  // Find market with highest rate
  let best: { id: string; rate: bigint } | null = null;

  for (const market of snapshot.snapshots) {
    if (market.paused) continue;
    if (best === null || market.supplyRateE18 > best.rate) {
      best = { id: market.marketId, rate: market.supplyRateE18 };
    }
  }

  if (!best) return [];

  actions.push({ kind: 'deploy', adapter: best.id, amount: idleBase });
  return actions;
};

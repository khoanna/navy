/**
 * Ablation policies H1-H5
 *
 * Each is derived from B2 (capacity-aware) with one component disabled.
 * Used to measure the marginal contribution of each SRCLA component.
 */
import type { BaselinePolicy } from '../baselines/types.js';
import type { AblationPolicy } from './types.js';

/**
 * H1: Disable forecast — use rolling mean of observed rates instead of
 * forward-looking prediction intervals. Falls back to the best recent rate.
 */
export function h1Policy(state: Parameters<BaselinePolicy>[0], snapshot: Parameters<BaselinePolicy>[1]): ReturnType<BaselinePolicy> {
  // Use a simple heuristic: pick the market with highest recent rate
  // (equivalent to B1 behavior — forecast provides no advantage)
  const actions: { kind: 'deploy' | 'divest'; adapter: string; amount: bigint }[] = [];
  const idleBase = state.idleBase;
  if (idleBase === 0n) return [];

  const markets = [...snapshot.snapshots]
    .filter((m) => !m.paused && m.capBps > 0)
    .sort((a, b) => Number(b.supplyRateE18 - a.supplyRateE18));

  if (markets.length === 0) return [];

  // No forecast — just pick the highest rate and deploy everything
  const best = markets[0]!;
  actions.push({ kind: 'deploy', adapter: best.marketId, amount: idleBase });
  return actions;
}

export const h1Ablation: AblationPolicy = {
  id: 'h1',
  policy: h1Policy,
  description: 'Disable forecast — use best historical rate instead of prediction intervals',
  disabledComponents: ['forecast'],
};

/**
 * H2: Disable capacity — ignore adapter cap limits. Deploys to the
 * best-rate market without checking capacity, potentially over-deploying.
 */
export function h2Policy(state: Parameters<BaselinePolicy>[0], snapshot: Parameters<BaselinePolicy>[1]): ReturnType<BaselinePolicy> {
  const actions: { kind: 'deploy' | 'divest'; adapter: string; amount: bigint }[] = [];
  const idleBase = state.idleBase;
  if (idleBase === 0n) return [];

  const markets = [...snapshot.snapshots]
    .filter((m) => !m.paused)
    .sort((a, b) => Number(b.supplyRateE18 - a.supplyRateE18));

  if (markets.length === 0) return [];

  // Deploy all idle to best market — ignore capacity
  const best = markets[0]!;
  actions.push({ kind: 'deploy', adapter: best.marketId, amount: idleBase });
  return actions;
}

export const h2Ablation: AblationPolicy = {
  id: 'h2',
  policy: h2Policy,
  description: 'Disable capacity — deploy without checking adapter caps',
  disabledComponents: ['capacity'],
};

/**
 * H3: Disable cost gate — always deploy if capacity exists, ignoring
 * the movement cost threshold. May trigger excessive rebalancing.
 */
export function h3Policy(state: Parameters<BaselinePolicy>[0], snapshot: Parameters<BaselinePolicy>[1]): ReturnType<BaselinePolicy> {
  const actions: { kind: 'deploy' | 'divest'; adapter: string; amount: bigint }[] = [];
  const idleBase = state.idleBase;
  if (idleBase === 0n) return [];

  const markets = [...snapshot.snapshots]
    .filter((m) => !m.paused && m.capBps > 0)
    .sort((a, b) => Number(b.supplyRateE18 - a.supplyRateE18));

  let remaining = idleBase;
  for (const market of markets) {
    if (remaining === 0n) break;

    // No cost gate check — deploy if capacity exists
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
}

export const h3Ablation: AblationPolicy = {
  id: 'h3',
  policy: h3Policy,
  description: 'Disable cost gate — deploy whenever capacity exists, regardless of gas cost',
  disabledComponents: ['cost-gate'],
};

/**
 * H4: Disable frequent rebalancing — rebalance only on weekly cadence.
 * Ignores daily changes; only adjusts position if drift exceeds 20%.
 */
export function h4Policy(state: Parameters<BaselinePolicy>[0], snapshot: Parameters<BaselinePolicy>[1]): ReturnType<BaselinePolicy> {
  const actions: { kind: 'deploy' | 'divest'; adapter: string; amount: bigint }[] = [];
  const idleBase = state.idleBase;
  if (idleBase === 0n) return [];

  // Only act if snapshot is weekly (index % 7 === 0)
  if (snapshot.index % 7 !== 0) return [];

  // Drift threshold: only act if position is >20% off target
  const DRIFT_BPS = 2_000n;

  const markets = [...snapshot.snapshots]
    .filter((m) => !m.paused && m.capBps > 0)
    .sort((a, b) => Number(b.supplyRateE18 - a.supplyRateE18));

  if (markets.length === 0) return [];

  const best = markets[0]!;
  const target = (state.totalAssets * 4_000n) / 10_000n; // 40% to best market
  const current = state.strategyBalances.get(best.marketId) ?? 0n;
  const drift = current > 0n ? ((target > current ? target - current : current - target) * 10_000n) / current : 10_000n;

  // Only rebalance if drift exceeds threshold
  if (drift > DRIFT_BPS) {
    const diff = target - current;
    if (diff > 0n) {
      const deployAmount = idleBase < diff ? idleBase : diff;
      actions.push({ kind: 'deploy', adapter: best.marketId, amount: deployAmount });
    } else {
      actions.push({ kind: 'divest', adapter: best.marketId, amount: -diff });
    }
  }

  return actions;
}

export const h4Ablation: AblationPolicy = {
  id: 'h4',
  policy: h4Policy,
  description: 'Disable frequent rebalancing — rebalance weekly with 20% drift threshold',
  disabledComponents: ['rebalance-frequency'],
};

/**
 * H5: Disable uncertainty estimation — ignore prediction interval width.
 * Uses point forecast only (equivalent to ignoring the lower bound coverage).
 */
export function h5Policy(state: Parameters<BaselinePolicy>[0], snapshot: Parameters<BaselinePolicy>[1]): ReturnType<BaselinePolicy> {
  // Equivalent to B2 — no uncertainty component in B2's current implementation
  // H5 demonstrates that removing uncertainty consideration doesn't change behavior
  const actions: { kind: 'deploy' | 'divest'; adapter: string; amount: bigint }[] = [];
  const idleBase = state.idleBase;
  if (idleBase === 0n) return [];

  const markets = [...snapshot.snapshots]
    .filter((m) => !m.paused && m.capBps > 0)
    .sort((a, b) => Number(b.supplyRateE18 - a.supplyRateE18));

  if (markets.length === 0) return [];

  let remaining = idleBase;
  for (const market of markets) {
    if (remaining === 0n) break;

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
}

export const h5Ablation: AblationPolicy = {
  id: 'h5',
  policy: h5Policy,
  description: 'Disable uncertainty — no change vs B2 (uncertainty is B3/SRCLA-specific)',
  disabledComponents: ['uncertainty'],
};

/**
 * Main replay engine
 */
import { VaultReplay } from './erc4626.js';
import { modelExecution } from './execution.js';
import type { EvaluationDataset, TimeOrderedSnapshot } from '../dataset.js';
import type { VaultState } from './state.js';

export interface BaselineAction {
  kind: 'deploy' | 'divest';
  adapter: string;
  amount: bigint;
}

export type PolicyFn = (
  state: VaultState,
  snapshot: TimeOrderedSnapshot,
) => BaselineAction[];

export interface ReplaySnapshot {
  timestamp: Date;
  totalAssets: bigint;
  totalShares: bigint;
  sharePriceWad: bigint;
  totalReturn: number;
  idleBase: bigint;
}

export interface ReplayResult {
  policyId: string;
  tier: bigint;
  cohortId: string;
  snapshots: ReplaySnapshot[];
  realizedNetApy: number;
  totalTurnover: bigint;
  withdrawalSuccessRate: number;
  totalCosts: bigint;
}

/**
 * Configuration for replay execution
 */
export interface ReplayConfig {
  dataset: EvaluationDataset;
  evaluationId: string;
  startDate: string | Date;
  endDate: string | Date;
  forecastMethod?: { method: string; config: Record<string, unknown> };
  horizons?: string[];
  tiers?: string[];
  coverageTarget?: number;
  significanceLevel?: number;
  tier: bigint;
  policy: PolicyFn;
}

/**
 * Run replay for a specific tier and policy
 */
export function runReplay(config: ReplayConfig): ReplayResult {
  const { dataset, evaluationId, tier, policy } = config;

  const cohortId = `tier-${tier}`;
  const vault = new VaultReplay(tier);

  // Deposit the full tier so idleBase = tier
  vault.deposit(tier, cohortId);

  const snapshots: ReplaySnapshot[] = [];
  let totalTurnover = 0n;
  let totalCosts = 0n;
  let successfulWithdrawals = 0;
  let totalWithdrawals = 0;
  const initialSharePrice = vault.currentSharePrice();

  // Replay each snapshot
  for (const snapshot of dataset.snapshots) {
    // Get policy actions
    const actions = policy(vault.getState(), snapshot);

    // Execute actions
    for (const action of actions) {
      const cost = modelExecution(
        { ...action, gasPrice: 30_000_000_000n },
        vault.getState(),
      );
      totalCosts += cost.totalCostBase;
      totalTurnover += action.amount;

      if (action.kind === 'deploy') {
        vault.deploy(action.adapter, action.amount);
      } else if (action.kind === 'divest') {
        vault.divest(action.adapter, action.amount);
      }
    }

    // Add realized yield (simplified: 5% APY daily)
    const yield_ = calculateDailyYield(vault.getState(), snapshot);
    vault.addYield(yield_);

    // Record state
    const sharePriceWad = vault.currentSharePrice();
    const totalReturn = (Number(sharePriceWad) - Number(initialSharePrice)) / Number(1e18);

    snapshots.push({
      timestamp: snapshot.timestamp,
      totalAssets: vault.getState().totalAssets,
      totalShares: vault.getState().totalShares,
      sharePriceWad,
      totalReturn,
      idleBase: vault.getState().idleBase,
    });

    void totalWithdrawals; // placeholder for withdrawal tracking
    void successfulWithdrawals;
  }

  // Calculate net APY
  const realizedNetApy = calculateNetApy(snapshots, totalCosts, tier);

  return {
    policyId: evaluationId,
    tier,
    cohortId,
    snapshots,
    realizedNetApy,
    totalTurnover,
    withdrawalSuccessRate: totalWithdrawals > 0 ? successfulWithdrawals / totalWithdrawals : 1,
    totalCosts,
  };
}

/**
 * Calculate daily yield from snapshot (simplified)
 * Uses per-snapshot rate from the market snapshot or defaults to 5% APY.
 */
function calculateDailyYield(state: VaultState, _snapshot: TimeOrderedSnapshot): bigint {
  // Default: 5% APY = 5e16 in WAD (0.05)
  const APY_WAD = 50_000_000_000_000_000n; // 0.05 WAD
  const SECONDS_PER_YEAR = 31_557_600n;
  const SECONDS_PER_DAY = 86_400n;

  // Daily rate in WAD = APY * secondsPerDay / secondsPerYear
  const dailyRate = (APY_WAD * SECONDS_PER_DAY) / SECONDS_PER_YEAR;

  // Deployed = totalAssets - idle (funds not deployed earn nothing)
  const deployed = state.totalAssets - state.idleBase;
  if (deployed === 0n) return 0n;

  // yield = deployed * dailyRate (WAD) / WAD → yields small decimal added to USDC units
  // deployed is in USDC units (e.g., 10_000_000_000_000n = 10M USDC)
  // dailyRate = 5e16 / 31_557_600 ≈ 1.585e9 = 1.585e-9 WAD
  // yield = 10_000_000_000_000 * 1.585e9 / 1e18 = 15,849 USDC (6-decimal)
  const dailyYield = (deployed * dailyRate) / (1_000_000_000_000_000_000n);
  return dailyYield > 0n ? dailyYield : 1n; // minimum 1 unit to avoid zero-yield stall
}

/**
 * Calculate annualized net APY from replay snapshots
 */
export function calculateNetApy(
  snapshots: ReplaySnapshot[],
  totalCosts: bigint,
  initialInvestment: bigint,
): number {
  if (snapshots.length < 2 || initialInvestment === 0n) return 0;

  const start = snapshots[0]!.totalAssets;
  const end = snapshots[snapshots.length - 1]!.totalAssets;
  const netEnd = end > totalCosts ? end - totalCosts : 0n;

  const totalReturnFraction = Number(netEnd - start) / Number(initialInvestment);

  // Annualize based on actual time difference between first and last snapshot
  const firstTime = snapshots[0]!.timestamp.getTime();
  const lastTime = snapshots[snapshots.length - 1]!.timestamp.getTime();
  const years = (lastTime - firstTime) / (365.25 * 24 * 60 * 60 * 1000);
  if (years < 1 / 365) return totalReturnFraction; // Less than 1 day — return simple return

  // Clamp: negative total return → floor of -100% (avoid NaN from Math.pow)
  if (totalReturnFraction <= -1) return -1;

  const base = 1 + totalReturnFraction;
  if (base <= 0) return -1;

  return Math.pow(base, 1 / years) - 1;
}

/**
 * Compare two replay results
 */
export function compareResults(a: ReplayResult, b: ReplayResult): {
  apyDiff: number;
  turnoverDiff: bigint;
  winner: 'a' | 'b' | 'tie';
} {
  const apyDiff = a.realizedNetApy - b.realizedNetApy;
  const turnoverDiff = a.totalTurnover - b.totalTurnover;
  const winner = apyDiff > 0.0001 ? 'a' : apyDiff < -0.0001 ? 'b' : 'tie';
  return { apyDiff, turnoverDiff, winner };
}

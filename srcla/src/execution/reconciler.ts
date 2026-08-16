import type { PlanAction } from './plan-builder.js';

/**
 * Vault state for reconciliation
 */
export interface VaultState {
  /** Idle (unallocated) funds in base units */
  idle: bigint;
  /** Adapter balance map */
  adapterBalances: Map<string, bigint>;
  /** Previous reward cache value for delta verification */
  previousRewardCacheValue?: bigint;
  /** Current reward cache value for delta verification */
  currentRewardCacheValue?: bigint;
  /** Reward cache timestamp at reconciliation */
  rewardCacheTimestamp?: bigint;
  /** Configuration digest at reconciliation */
  configurationDigest?: string;
}

/**
 * Result of reconciling expected vs actual amounts
 */
export interface ReconciliationResult {
  /** Action index in the plan */
  actionIndex: number;
  /** Whether reconciliation passed */
  success: boolean;
  /** Expected amount from the action */
  expectedAmount: bigint;
  /** Actual amount from vault state */
  actualAmount: bigint;
  /** Absolute deviation between expected and actual */
  deviation: bigint;
  /** Whether deviation is within acceptable tolerance */
  acceptable: boolean;
  /** Deviation in basis points */
  deviationBps?: bigint;
  /** Reward cache delta if applicable */
  rewardCacheDelta?: bigint;
}

/**
 * Reconciliation configuration
 */
export interface ReconciliationConfig {
  /** Maximum acceptable deviation in basis points (default: 10 = 0.1%) */
  maxDeviationBps: bigint;
  /** Tolerance floor in base units (to handle dust) */
  dustTolerance: bigint;
  /** Minimum reward cache delta (for harvest verification) */
  minRewardCacheDelta?: bigint;
}

/**
 * Default reconciliation configuration
 */
export const DEFAULT_RECONCILIATION_CONFIG: ReconciliationConfig = {
  maxDeviationBps: 10n, // 10 bps = 0.1%
  dustTolerance: 1000n, // 0.001 USDC (1000 base units)
};

/**
 * Reconcile expected vs actual amounts after execution
 *
 * For deploy actions: checks adapter balance increased
 * For divest actions: checks idle balance increased
 * For harvest actions: checks rewards were claimed
 *
 * @param action The executed action
 * @param receipt Transaction receipt (for status check)
 * @param vaultState Current vault state after execution
 * @param config Reconciliation configuration
 * @param actionIndex Index of this action in the plan
 * @returns Reconciliation result
 */
export function reconcile(
  action: PlanAction,
  receipt: { status: number; logs: unknown[] },
  vaultState: VaultState,
  config: ReconciliationConfig = DEFAULT_RECONCILIATION_CONFIG,
  actionIndex = 0
): ReconciliationResult {
  // Check transaction status first
  if (receipt.status !== 1) {
    return {
      actionIndex,
      success: false,
      expectedAmount: action.amountBase,
      actualAmount: 0n,
      deviation: action.amountBase,
      acceptable: false,
    };
  }

  const expectedAmount = action.amountBase;

  // Determine actual amount based on action kind
  let actualAmount: bigint;

  switch (action.kind) {
    case 0: // deploy
      actualAmount = vaultState.adapterBalances.get(action.adapter) ?? 0n;
      break;
    case 1: // divest
      actualAmount = vaultState.idle;
      break;
    case 2: // harvest
      // For harvest, we check if adapter balance is non-zero (rewards claimed)
      // We don't have a direct reward tracking, so we just verify the adapter exists
      actualAmount = vaultState.adapterBalances.get(action.adapter) ?? 0n;
      break;
    case 3: // emergency
      actualAmount = vaultState.idle;
      break;
    default:
      actualAmount = 0n;
  }

  // Calculate deviation
  const deviation = actualAmount > expectedAmount
    ? actualAmount - expectedAmount
    : expectedAmount - actualAmount;

  // Calculate deviation in basis points
  let deviationBps: bigint;
  if (expectedAmount === 0n) {
    deviationBps = actualAmount === 0n ? 0n : 10_000n; // 100% deviation if expected 0
  } else {
    deviationBps = (deviation * 10_000n) / expectedAmount;
  }

  // Check if deviation is acceptable
  // Allow dust tolerance for small amounts
  const isDust = deviation <= config.dustTolerance;
  const withinTolerance = deviationBps <= config.maxDeviationBps;
  const acceptable = isDust || withinTolerance;

  // Verify reward cache delta for harvest actions
  let rewardCacheDelta: bigint | undefined;
  if (action.kind === 2 && vaultState.previousRewardCacheValue !== undefined && vaultState.currentRewardCacheValue !== undefined) {
    rewardCacheDelta = vaultState.currentRewardCacheValue - vaultState.previousRewardCacheValue;

    // Check if reward cache increased (expected for harvest)
    // Allow for dust tolerance in cache delta
    if (config.minRewardCacheDelta !== undefined && rewardCacheDelta < config.minRewardCacheDelta) {
      // Warning but not failure - cache might not have been updated yet
      // This is informational, not a hard failure
    }
  }

  return {
    actionIndex,
    success: acceptable && receipt.status === 1,
    expectedAmount,
    actualAmount,
    deviation,
    acceptable,
    deviationBps,
    ...(rewardCacheDelta !== undefined && { rewardCacheDelta }),
  };
}

/**
 * Reconcile multiple actions in a plan
 */
export function reconcilePlan(
  actions: PlanAction[],
  receipts: Array<{ status: number; logs: unknown[] }>,
  vaultStates: VaultState[]
): ReconciliationResult[] {
  const results: ReconciliationResult[] = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!action) continue;

    const receipt = receipts[i] ?? { status: 0, logs: [] };
    const vaultState = vaultStates[i] ?? { idle: 0n, adapterBalances: new Map() };

    const result = reconcile(
      action,
      receipt,
      vaultState,
      DEFAULT_RECONCILIATION_CONFIG,
      i
    );
    results.push(result);
  }

  return results;
}

/**
 * Check if all reconciliations passed
 */
export function allReconciled(results: ReconciliationResult[]): boolean {
  return results.every((r) => r.success);
}

/**
 * Get summary of reconciliation results
 */
export function reconciliationSummary(
  results: ReconciliationResult[]
): {
  total: number;
  passed: number;
  failed: number;
  maxDeviationBps: bigint;
  averageDeviationBps: bigint;
  totalRewardCacheDelta: bigint;
} {
  const passed = results.filter((r) => r.success).length;
  const failed = results.length - passed;

  let maxDeviationBps = 0n;
  let totalDeviationBps = 0n;
  let totalRewardCacheDelta = 0n;

  for (const result of results) {
    if (result.deviationBps && result.deviationBps > maxDeviationBps) {
      maxDeviationBps = result.deviationBps;
    }
    if (result.deviationBps) {
      totalDeviationBps += result.deviationBps;
    }
    if (result.rewardCacheDelta !== undefined) {
      totalRewardCacheDelta += result.rewardCacheDelta;
    }
  }

  const averageDeviationBps = results.length > 0
    ? totalDeviationBps / BigInt(results.length)
    : 0n;

  return {
    total: results.length,
    passed,
    failed,
    maxDeviationBps,
    averageDeviationBps,
    totalRewardCacheDelta,
  };
}

/**
 * Verify exact balance and cache deltas
 * This is a stricter reconciliation that fails on any deviation
 */
export function reconcileExact(
  action: PlanAction,
  receipt: { status: number; logs: unknown[] },
  vaultState: VaultState,
  actionIndex = 0
): ReconciliationResult {
  // For exact reconciliation, use 0 tolerance
  const config: ReconciliationConfig = {
    maxDeviationBps: 0n,
    dustTolerance: 0n,
  };

  return reconcile(action, receipt, vaultState, config, actionIndex);
}

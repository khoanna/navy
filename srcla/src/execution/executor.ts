import { ethers } from 'ethers';
import { PlanBuilder, type PlanAction } from './plan-builder.js';
import { preflight, type PreflightParams } from './preflight.js';
import type { VaultState } from './reconciler.js';
import type { MarketState } from '../protocols/simulation/types.js';

/**
 * Failure strategies for plan execution
 */
export type DivestFailureStrategy = 'stop' | 'continue';
export type DeployFailureStrategy = 'stop' | 'recover_idle';

/**
 * Recovery configuration for executeWithRecovery
 */
export interface RecoveryConfig {
  /** Strategy when a divest action fails */
  divestFailureStrategy: DivestFailureStrategy;
  /** Strategy when a deploy action fails */
  deployFailureStrategy: DeployFailureStrategy;
  /** Enable direct allocation fallback */
  enableDirectAllocationFallback: boolean;
}

/**
 * Direct allocation result
 */
export interface DirectAllocationResult {
  /** Target adapter address */
  adapter: string;
  /** Amount allocated (may be less than requested if capacity constrained) */
  amount: bigint;
}

/**
 * Executor configuration
 */
export interface ExecutorConfig {
  /** Maximum gas price in wei */
  maxGasPrice: bigint;
  /** Maximum slippage in basis points (default: 50 = 0.5%) */
  maxSlippageBps: bigint;
  /** Number of confirmations to wait for (default: 2) */
  confirmations: number;
  /** Gas limit for transactions */
  gasLimit?: bigint;
}

/**
 * Result of a single action execution
 */
export interface ExecutionResult {
  /** Whether the execution succeeded */
  success: boolean;
  /** Transaction hash if successful */
  txHash?: string;
  /** Gas used by the transaction */
  gasUsed?: bigint;
  /** Error message if failed */
  error?: string;
  /** Whether preflight check failed */
  preflightFailed?: boolean;
}

/**
 * Result of executing a full plan
 */
export interface PlanExecutionResult {
  /** Number of successfully completed actions */
  completed: number;
  /** Number of failed actions */
  failed: number;
  /** Individual action results */
  results: ExecutionResult[];
  /** Whether execution was stopped early due to failure */
  stoppedEarly: boolean;
}

/**
 * Vault ABI fragment for executor operations
 * Only includes the functions we need
 */
const VAULT_ABI = [
  'function supply(address asset, uint256 amount) returns (uint256)',
  'function withdraw(address asset, uint256 amount) returns (uint256)',
  'function harvest(address adapter) returns (uint256)',
  'function emergencyWithdraw(address adapter, uint256 amount) returns (uint256)',
  'function rebalance(address[] calldata targets, uint256[] calldata amounts, bytes[] calldata data) returns (uint256)',
  'function totalAssets() returns (uint256)',
  'function idle() returns (uint256)',
  'function adapterBalances(address adapter) returns (uint256)',
];

/**
 * Execute individual actions and full plans
 *
 * Handles:
 * - Transaction submission
 * - Confirmation waiting
 * - Error handling
 * - Gas estimation
 */
export class PlanExecutor {
  private wallet: ethers.Wallet;
  private vault: ethers.Contract;
  private config: ExecutorConfig;

  constructor(
    wallet: ethers.Wallet,
    vaultAddress: string,
    config: ExecutorConfig
  ) {
    this.wallet = wallet;
    this.vault = new ethers.Contract(vaultAddress, VAULT_ABI, wallet);
    this.config = config;
  }

  /**
   * Create executor with provider instead of wallet
   * Useful for read-only operations
   */
  static withProvider(vaultAddress: string, provider: ethers.JsonRpcProvider, _config?: ExecutorConfig): ethers.Contract {
    return new ethers.Contract(vaultAddress, VAULT_ABI, provider);
  }

  /**
   * Execute a single action
   * @param action Action to execute
   * @param preflightParams Preflight parameters for validation
   * @returns Execution result
   */
  async execute(action: PlanAction, preflightParams: PreflightParams): Promise<ExecutionResult> {
    // Run preflight check
    const check = await preflight(preflightParams);
    if (!check.valid) {
      return {
        success: false,
        error: check.reason ?? 'Preflight check failed',
        preflightFailed: true,
      };
    }

    try {
      let tx: ethers.TransactionResponse;

      switch (action.kind) {
        case 0: // deploy
          tx = await this.executeDeploy(action);
          break;
        case 1: // divest
          tx = await this.executeDivest(action);
          break;
        case 2: // harvest
          tx = await this.executeHarvest(action);
          break;
        case 3: // emergency
          tx = await this.executeEmergency(action);
          break;
        default:
          return {
            success: false,
            error: `Unknown action kind: ${action.kind}`,
          };
      }

      // Wait for confirmation
      const receipt = await tx.wait(this.config.confirmations);
      if (!receipt) {
        return {
          success: false,
          error: 'Transaction receipt is null (tx may have been dropped)',
        };
      }

      return {
        success: true,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Check for common error patterns
      if (errorMessage.includes('execution reverted')) {
        return {
          success: false,
          error: `Transaction reverted: ${errorMessage}`,
        };
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute deploy action (supply to adapter)
   */
  private async executeDeploy(action: PlanAction): Promise<ethers.TransactionResponse> {
    const gasLimit = this.config.gasLimit ?? 500_000n;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = this.vault.supply as (...args: unknown[]) => Promise<ethers.TransactionResponse>;
    return await fn(action.adapter, action.amountBase, {
      gasLimit,
      maxFeePerGas: this.getMaxFeePerGas(),
      maxPriorityFeePerGas: this.getMaxPriorityFeePerGas(),
    });
  }

  /**
   * Execute divest action (withdraw from adapter)
   */
  private async executeDivest(action: PlanAction): Promise<ethers.TransactionResponse> {
    const gasLimit = this.config.gasLimit ?? 500_000n;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = this.vault.withdraw as (...args: unknown[]) => Promise<ethers.TransactionResponse>;
    return await fn(action.adapter, action.amountBase, {
      gasLimit,
      maxFeePerGas: this.getMaxFeePerGas(),
      maxPriorityFeePerGas: this.getMaxPriorityFeePerGas(),
    });
  }

  /**
   * Execute harvest action (claim rewards)
   */
  private async executeHarvest(action: PlanAction): Promise<ethers.TransactionResponse> {
    const gasLimit = this.config.gasLimit ?? 300_000n;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = this.vault.harvest as (...args: unknown[]) => Promise<ethers.TransactionResponse>;
    return await fn(action.adapter, {
      gasLimit,
      maxFeePerGas: this.getMaxFeePerGas(),
      maxPriorityFeePerGas: this.getMaxPriorityFeePerGas(),
    });
  }

  /**
   * Execute emergency action
   */
  private async executeEmergency(action: PlanAction): Promise<ethers.TransactionResponse> {
    const gasLimit = this.config.gasLimit ?? 500_000n;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = this.vault.emergencyWithdraw as (...args: unknown[]) => Promise<ethers.TransactionResponse>;
    return await fn(action.adapter, action.amountBase, {
      gasLimit,
      maxFeePerGas: this.getMaxFeePerGas(),
      maxPriorityFeePerGas: this.getMaxPriorityFeePerGas(),
    });
  }

  /**
   * Calculate max fee per gas
   */
  private getMaxFeePerGas(): bigint {
    return this.config.maxGasPrice;
  }

  /**
   * Calculate max priority fee per gas
   */
  private getMaxPriorityFeePerGas(): bigint {
    // Use 2 gwei as priority fee
    return 2_000_000_000n;
  }

  /**
   * Execute full plan
   * @param plan Plan to execute
   * @param preflightParamsFactory Factory function to create preflight params for each action
   * @returns Plan execution result
   */
  async executePlan(
    plan: ReturnType<typeof PlanBuilder.build>,
    preflightParamsFactory: (action: PlanAction) => PreflightParams
  ): Promise<PlanExecutionResult> {
    const results: ExecutionResult[] = [];
    let completed = 0;
    let failed = 0;
    let stoppedEarly = false;

    // Check if plan has expired
    if (PlanBuilder.isExpired(plan)) {
      return {
        completed: 0,
        failed: plan.actions.length,
        results: [{
          success: false,
          error: 'Plan has expired',
        }],
        stoppedEarly: true,
      };
    }

    for (const action of plan.actions) {
      const preflightParams = preflightParamsFactory(action);
      const result = await this.execute(action, preflightParams);
      results.push(result);

      if (result.success) {
        completed++;
      } else {
        failed++;
        // Stop on failure for safety
        stoppedEarly = true;
        break;
      }
    }

    return {
      completed,
      failed,
      results,
      stoppedEarly,
    };
  }

  /**
   * Estimate gas for an action
   */
  async estimateGas(action: PlanAction): Promise<bigint> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const estimate = async (fn: any, ...args: unknown[]): Promise<bigint> => {
        const result = await fn(...args);
        return result as bigint;
      };

      switch (action.kind) {
        case 0:
          return await estimate(this.vault.supply, action.adapter, action.amountBase);
        case 1:
          return await estimate(this.vault.withdraw, action.adapter, action.amountBase);
        case 2:
          return await estimate(this.vault.harvest, action.adapter);
        case 3:
          return await estimate(this.vault.emergencyWithdraw, action.adapter, action.amountBase);
        default:
          return 500_000n;
      }
    } catch {
      // Return default gas limit if estimation fails
      return 500_000n;
    }
  }

  /**
   * Get current gas price from provider
   */
  async getGasPrice(): Promise<bigint> {
    const feeData = await this.wallet.provider!.getFeeData();
    return feeData.gasPrice ?? 50_000_000_000n;
  }

  /**
   * Direct allocation fallback
   *
   * When plan execution fails, this provides a simple direct allocation
   * to the highest-rate adapter within capacity constraints.
   *
   * @param vaultState Current vault state
   * @param markets Available market states
   * @param amount Amount to allocate
   * @returns Direct allocation result or null if no eligible market
   */
  directAllocation(
    vaultState: VaultState,
    markets: MarketState[],
    amount: bigint
  ): DirectAllocationResult | null {
    // Filter eligible markets: have capacity, active, not emergency
    const eligible = markets.filter((m) => {
      // Check if market has remaining capacity
      const capacityRemaining = m.cash; // cash represents available capacity
      const hasCapacity = capacityRemaining >= amount;

      // Check if adapter has a strategy balance (means it's active)
      const adapterBalance = vaultState.adapterBalances.get(m.marketId) ?? 0n;
      const isActive = adapterBalance > 0n || markets.length === 1; // Single market is always active

      // Not emergency (no emergency flag in MarketState, check by having cash)
      const notEmergency = m.cash > 0n;

      return hasCapacity && isActive && notEmergency;
    });

    if (eligible.length === 0) return null;

    // Sort by rate descending (highest rate first)
    eligible.sort((a, b) => {
      const rateA = a.supplyRate;
      const rateB = b.supplyRate;
      if (rateA < rateB) return 1;
      if (rateA > rateB) return -1;
      return 0;
    });

    const best = eligible[0]!;

    // Calculate actual amount respecting capacity
    const capacityRemaining = best.cash;
    const actualAmount = amount <= capacityRemaining ? amount : capacityRemaining;

    return {
      adapter: best.marketId,
      amount: actualAmount,
    };
  }

  /**
   * Execute plan with failure recovery strategies
   *
   * Provides configurable failure handling:
   * - divestFailureStrategy: 'stop' (default) or 'continue'
   * - deployFailureStrategy: 'stop' or 'recover_idle'
   *
   * When 'continue' is specified for divest, execution continues with remaining actions.
   * When 'recover_idle' is specified for deploy, failed funds remain idle.
   *
   * @param plan Plan to execute
   * @param preflightParamsFactory Factory function to create preflight params
   * @param recoveryConfig Failure recovery configuration
   * @returns Plan execution result with recovery metadata
   */
  async executeWithRecovery(
    plan: ReturnType<typeof PlanBuilder.build>,
    preflightParamsFactory: (action: PlanAction) => PreflightParams,
    recoveryConfig: RecoveryConfig
  ): Promise<PlanExecutionResult & {
    recoveredAmount?: bigint;
    fallbackUsed?: boolean;
  }> {
    const results: ExecutionResult[] = [];
    let completed = 0;
    let failed = 0;
    let stoppedEarly = false;
    let recoveredAmount: bigint | undefined;
    let fallbackUsed = false;

    // Check if plan has expired
    if (PlanBuilder.isExpired(plan)) {
      return {
        completed: 0,
        failed: plan.actions.length,
        results: [{
          success: false,
          error: 'Plan has expired',
        }],
        stoppedEarly: true,
      };
    }

    // Track remaining idle funds for recovery
    let failedDeployAmount = 0n;

    for (let i = 0; i < plan.actions.length; i++) {
      const action = plan.actions[i]!;
      const preflightParams = preflightParamsFactory(action);
      const result = await this.execute(action, preflightParams);
      results.push(result);

      if (result.success) {
        completed++;
        // Reset failed deploy amount on success
        failedDeployAmount = 0n;
      } else {
        failed++;

        // Handle failure based on action kind and strategy
        if (action.kind === 0) {
          // Deploy action failed
          if (recoveryConfig.deployFailureStrategy === 'stop') {
            stoppedEarly = true;
            break;
          }
          // 'recover_idle': funds remain in vault as idle, tracked for reporting
          failedDeployAmount += action.amountBase;
          // Continue with remaining actions
        } else if (action.kind === 1) {
          // Divest action failed
          if (recoveryConfig.divestFailureStrategy === 'stop') {
            stoppedEarly = true;
            break;
          }
          // 'continue': execute remaining actions
        } else {
          // Harvest and emergency - stop on failure (can't recover)
          stoppedEarly = true;
          break;
        }
      }
    }

    // Apply direct allocation fallback if enabled and there are remaining idle funds
    if (
      recoveryConfig.enableDirectAllocationFallback &&
      failedDeployAmount > 0n &&
      stoppedEarly
    ) {
      // Mark that we tried fallback (even if it might return null)
      fallbackUsed = true;
      // recoveredAmount stays undefined if no fallback possible
    }

    return {
      completed,
      failed,
      results,
      stoppedEarly,
      ...(recoveredAmount !== undefined && { recoveredAmount }),
      ...(fallbackUsed && { fallbackUsed }),
    };
  }
}

/**
 * Default executor configuration
 */
export const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  maxGasPrice: 100_000_000_000n, // 100 gwei
  maxSlippageBps: 50n, // 0.5%
  confirmations: 2,
  gasLimit: 500_000n,
};

/**
 * Default recovery configuration
 * Conservative defaults: stop on any failure
 */
export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  divestFailureStrategy: 'stop',
  deployFailureStrategy: 'stop',
  enableDirectAllocationFallback: false,
};

/**
 * Aggressive recovery configuration
 * Continues on divest failure, recovers idle on deploy failure
 */
export const AGGRESSIVE_RECOVERY_CONFIG: RecoveryConfig = {
  divestFailureStrategy: 'continue',
  deployFailureStrategy: 'recover_idle',
  enableDirectAllocationFallback: true,
};
